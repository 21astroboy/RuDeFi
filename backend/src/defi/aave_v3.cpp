#include "cryptoapp/defi/aave_v3.hpp"

#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/chain/multicall.hpp"
#include "cryptoapp/util/hex.hpp"

#include <cstdio>
#include <sstream>

namespace cryptoapp::defi {

namespace {

// Selectors:
//   getUserAccountData(address)             -> 0xbf92857c
//   getReservesList()                       -> 0xd1946dbc
//   getReserveData(address)                 -> 0x35ea6a75   (returns ReserveData struct)
//   balanceOf(address)                      -> 0x70a08231
constexpr const char* SEL_GET_USER_ACCOUNT_DATA = "bf92857c";
constexpr const char* SEL_GET_RESERVES_LIST     = "d1946dbc";
constexpr const char* SEL_GET_RESERVE_DATA      = "35ea6a75";
constexpr const char* SEL_BALANCE_OF            = "70a08231";

void append_word_address(std::string& out, const chain::Address& a) {
    out.append(24, '0');
    auto h = util::hex_encode(a.bytes().data(), a.bytes().size());
    out.append(h, 2, std::string::npos);
}

std::string encode_get_user_account_data(const chain::Address& user) {
    std::string s = "0x";
    s.append(SEL_GET_USER_ACCOUNT_DATA);
    append_word_address(s, user);
    return s;
}
std::string encode_get_reserves_list() {
    return std::string("0x") + SEL_GET_RESERVES_LIST;
}
std::string encode_get_reserve_data(const chain::Address& asset) {
    std::string s = "0x";
    s.append(SEL_GET_RESERVE_DATA);
    append_word_address(s, asset);
    return s;
}
std::string encode_balance_of(const chain::Address& a) {
    std::string s = "0x";
    s.append(SEL_BALANCE_OF);
    append_word_address(s, a);
    return s;
}

chain::U256 word_at_u256(std::string_view h_no0x, std::size_t word_idx) {
    const std::size_t pos = word_idx * 64;
    if (pos + 64 > h_no0x.size())
        throw std::runtime_error("aave_v3: word index out of range");
    std::string_view w = h_no0x.substr(pos, 64);
    return chain::parse_hex_u256(std::string("0x") + std::string(w));
}
chain::Address word_at_address(std::string_view h_no0x, std::size_t word_idx) {
    const std::size_t pos = word_idx * 64;
    if (pos + 64 > h_no0x.size())
        throw std::runtime_error("aave_v3: address word out of range");
    return chain::Address::from_hex(std::string("0x") + std::string(h_no0x.substr(pos + 24, 40)));
}

double scale(const chain::U256& v, double divisor) {
    if (v == 0) return 0.0;
    return v.convert_to<double>() / divisor;
}
std::string fmt2(double v) {
    char buf[64];
    std::snprintf(buf, sizeof(buf), "%.2f", v);
    return buf;
}

const chain::TokenInfo* find_token(const chain::ChainConfig& cfg, const chain::Address& a) {
    for (const auto& t : cfg.tokens) if (t.address == a) return &t;
    return nullptr;
}

// Decode the dynamic address[] returned by getReservesList().
// Layout: word0 = offset (0x20). word1 = length. then N address words.
std::vector<chain::Address> decode_address_array(std::string_view h_no0x) {
    std::vector<chain::Address> out;
    if (h_no0x.size() < 2 * 64) return out;
    const auto offset = word_at_u256(h_no0x, 0).convert_to<std::uint64_t>();
    const auto base   = offset / 32;     // word index of the length
    const auto len    = word_at_u256(h_no0x, base).convert_to<std::uint64_t>();
    out.reserve(len);
    for (std::uint64_t i = 0; i < len; ++i) {
        out.push_back(word_at_address(h_no0x, base + 1 + i));
    }
    return out;
}

// Aave V3 ReserveData layout (15 static slots). aTokenAddress is at slot 8,
// variableDebtTokenAddress is at slot 10. See contracts/types/DataTypes.sol.
struct ReserveAddrs {
    chain::Address atoken;
    chain::Address vdebt;
};
ReserveAddrs decode_reserve_addrs(std::string_view h_no0x) {
    ReserveAddrs r;
    if (h_no0x.size() < 11 * 64) return r;
    r.atoken = word_at_address(h_no0x, 8);
    r.vdebt  = word_at_address(h_no0x, 10);
    return r;
}

// Per-token breakdown: returns up to N supply rows + M debt rows.
std::vector<DefiPosition> per_token_breakdown(chain::RpcClient& rpc,
                                              const chain::ChainConfig& cfg,
                                              const chain::Address& wallet,
                                              const chain::Address& pool_address,
                                              const std::string& protocol_label,
                                              double health_factor) {
    std::vector<DefiPosition> rows;

    // 1. getReservesList() — list of underlying assets in this chain's pool.
    std::vector<chain::Address> assets;
    try {
        auto h = util::normalize_hex(rpc.eth_call_hex(pool_address, encode_get_reserves_list()));
        assets = decode_address_array(h);
    } catch (...) { return rows; }
    if (assets.empty()) return rows;

    // 2. multicall: getReserveData(asset) for each — extract aToken & vDebt.
    std::vector<chain::Call3> rd_calls;
    rd_calls.reserve(assets.size());
    for (const auto& a : assets) {
        chain::Call3 c;
        c.target = pool_address;
        c.allow_failure = true;
        c.call_data_hex = encode_get_reserve_data(a);
        rd_calls.push_back(std::move(c));
    }
    std::vector<ReserveAddrs> reserve_addrs(assets.size());
    try {
        auto rs = chain::aggregate3(rpc, cfg.multicall3, rd_calls);
        for (std::size_t i = 0; i < rs.size() && i < assets.size(); ++i) {
            if (!rs[i].success) continue;
            reserve_addrs[i] = decode_reserve_addrs(util::normalize_hex(rs[i].return_data_hex));
        }
    } catch (...) { return rows; }

    // 3. multicall: aToken.balanceOf(wallet) and vDebt.balanceOf(wallet).
    std::vector<chain::Call3> bal_calls;
    std::vector<std::pair<std::size_t, bool>> bal_meta;  // (asset_idx, is_debt)
    const auto bal_data = encode_balance_of(wallet);
    for (std::size_t i = 0; i < assets.size(); ++i) {
        if (!reserve_addrs[i].atoken.is_zero()) {
            chain::Call3 c;
            c.target = reserve_addrs[i].atoken;
            c.allow_failure = true;
            c.call_data_hex = bal_data;
            bal_calls.push_back(std::move(c));
            bal_meta.emplace_back(i, false);
        }
        if (!reserve_addrs[i].vdebt.is_zero()) {
            chain::Call3 c;
            c.target = reserve_addrs[i].vdebt;
            c.allow_failure = true;
            c.call_data_hex = bal_data;
            bal_calls.push_back(std::move(c));
            bal_meta.emplace_back(i, true);
        }
    }
    if (bal_calls.empty()) return rows;

    std::vector<chain::Call3Result> bal_rs;
    try { bal_rs = chain::aggregate3(rpc, cfg.multicall3, bal_calls); }
    catch (...) { return rows; }

    for (std::size_t k = 0; k < bal_rs.size() && k < bal_meta.size(); ++k) {
        if (!bal_rs[k].success) continue;
        chain::U256 bal = chain::parse_hex_u256(bal_rs[k].return_data_hex);
        if (bal == 0) continue;

        const auto [aidx, is_debt] = bal_meta[k];
        const auto& asset = assets[aidx];
        const auto* tok   = find_token(cfg, asset);

        DefiPosition p;
        p.chain_key  = cfg.key;
        p.chain_name = cfg.name;
        p.protocol   = protocol_label;
        p.kind       = is_debt ? "borrow" : "supply";
        p.token0_address = asset;
        p.token0_symbol  = tok ? tok->symbol : asset.hex();
        p.decimals0      = tok ? tok->decimals : 18;
        p.token0_coingecko_id = tok ? tok->coingecko_id : std::string{};
        p.amount0_raw    = bal;
        p.health_factor  = health_factor;
        p.label = (is_debt ? "Долг " : "Депозит ") + p.token0_symbol;
        if (!cfg.explorer.empty()) {
            p.link = cfg.explorer + "/address/" +
                     (is_debt ? reserve_addrs[aidx].vdebt.hex() : reserve_addrs[aidx].atoken.hex());
        }
        rows.push_back(std::move(p));
    }
    return rows;
}

}  // namespace

std::vector<DefiPosition> scan_aave_v3(chain::RpcClient& rpc,
                                       const chain::ChainConfig& cfg,
                                       const chain::Address& wallet) {
    return scan_aave_like(rpc, cfg, wallet, cfg.aave_v3_pool, "Aave V3");
}

std::vector<DefiPosition> scan_aave_like(chain::RpcClient& rpc,
                                         const chain::ChainConfig& cfg,
                                         const chain::Address& wallet,
                                         const chain::Address& pool_address,
                                         const std::string& protocol_label) {
    std::vector<DefiPosition> out;
    if (pool_address.is_zero()) return out;

    std::string ret_hex;
    try {
        ret_hex = rpc.eth_call_hex(pool_address, encode_get_user_account_data(wallet));
    } catch (...) {
        throw;
    }

    auto h = util::normalize_hex(ret_hex);
    if (h.size() < 6 * 64) return out;

    const auto collateral = word_at_u256(h, 0);
    const auto debt       = word_at_u256(h, 1);
    const auto avail      = word_at_u256(h, 2);
    const auto health     = word_at_u256(h, 5);

    if (collateral == 0 && debt == 0) return out;

    const double col_usd   = scale(collateral, 1e8);
    const double debt_usd  = scale(debt,       1e8);
    const double avail_usd = scale(avail,      1e8);
    const double hf        = scale(health,     1e18);

    // Per-token breakdown: which tokens, how much. Adds 3 multicalls.
    auto details = per_token_breakdown(rpc, cfg, wallet, pool_address, protocol_label, hf);
    if (!details.empty()) {
        out.insert(out.end(), std::make_move_iterator(details.begin()),
                              std::make_move_iterator(details.end()));
    } else {
        // Fallback — RPC issue prevented breakdown but we know totals from
        // getUserAccountData. Show coarse rows so the user still sees the
        // position; Withdraw button won't appear (no per-token info).
        if (col_usd > 0) {
            DefiPosition p; p.chain_key = cfg.key; p.chain_name = cfg.name;
            p.protocol = protocol_label; p.kind = "supply";
            p.label = "Поставлено в качестве залога"; p.value_usd = col_usd;
            p.health_factor = hf;
            if (!cfg.explorer.empty()) p.link = cfg.explorer + "/address/" + pool_address.hex();
            out.push_back(std::move(p));
        }
        if (debt_usd > 0) {
            DefiPosition p; p.chain_key = cfg.key; p.chain_name = cfg.name;
            p.protocol = protocol_label; p.kind = "borrow";
            p.label = "Заёмная позиция"; p.value_usd = debt_usd;
            p.health_factor = hf;
            if (!cfg.explorer.empty()) p.link = cfg.explorer + "/address/" + pool_address.hex();
            out.push_back(std::move(p));
        }
    }

    // Summary row last — hf + available-to-borrow, doesn't go into totals.
    if (avail_usd > 0 || (col_usd > 0 && debt_usd > 0)) {
        DefiPosition p;
        p.chain_key = cfg.key;
        p.chain_name = cfg.name;
        p.protocol = protocol_label;
        p.kind = "summary";
        std::ostringstream ls;
        ls << "Доступно к займу " << fmt2(avail_usd) << " $";
        if (hf > 0 && hf < 1e9) ls << " · health " << fmt2(hf);
        p.label = ls.str();
        p.value_usd = 0;
        p.health_factor = hf;
        if (!cfg.explorer.empty()) p.link = cfg.explorer + "/address/" + pool_address.hex();
        out.push_back(std::move(p));
    }

    return out;
}

}  // namespace cryptoapp::defi

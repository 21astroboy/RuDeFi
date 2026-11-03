#include "cryptoapp/defi/compound_v3.hpp"

#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/chain/multicall.hpp"
#include "cryptoapp/util/hex.hpp"

#include <sstream>

namespace cryptoapp::defi {

namespace {

// Selectors:
//   balanceOf(address)            -> 0x70a08231
//   borrowBalanceOf(address)      -> 0x374c49b4
constexpr const char* SEL_BALANCE_OF        = "70a08231";
constexpr const char* SEL_BORROW_BALANCE_OF = "374c49b4";

void append_word_address(std::string& out, const chain::Address& a) {
    out.append(24, '0');
    auto h = util::hex_encode(a.bytes().data(), a.bytes().size());
    out.append(h, 2, std::string::npos);
}

std::string encode_balance_of(const chain::Address& a) {
    std::string s = "0x";
    s.append(SEL_BALANCE_OF);
    append_word_address(s, a);
    return s;
}
std::string encode_borrow_balance_of(const chain::Address& a) {
    std::string s = "0x";
    s.append(SEL_BORROW_BALANCE_OF);
    append_word_address(s, a);
    return s;
}

// Find token coingecko_id from registry by address — Compound markets always
// use canonical ERC-20 addresses we already have in tokens.json.
const chain::TokenInfo* find_token(const chain::ChainConfig& cfg, const chain::Address& a) {
    for (const auto& t : cfg.tokens) if (t.address == a) return &t;
    return nullptr;
}

}  // namespace

std::vector<DefiPosition> scan_compound_v3(chain::RpcClient& rpc,
                                           const chain::ChainConfig& cfg,
                                           const chain::Address& wallet) {
    std::vector<DefiPosition> out;
    if (cfg.compound_v3_markets.empty()) return out;

    // Build a single multicall: for each market, ask both balanceOf and
    // borrowBalanceOf. 2 reads × N markets per chain — single round trip.
    std::vector<chain::Call3> calls;
    calls.reserve(cfg.compound_v3_markets.size() * 2);
    for (const auto& m : cfg.compound_v3_markets) {
        chain::Call3 a; a.target = m.comet; a.allow_failure = true;
        a.call_data_hex = encode_balance_of(wallet);
        calls.push_back(std::move(a));

        chain::Call3 b; b.target = m.comet; b.allow_failure = true;
        b.call_data_hex = encode_borrow_balance_of(wallet);
        calls.push_back(std::move(b));
    }

    std::vector<chain::Call3Result> rs;
    try { rs = chain::aggregate3(rpc, cfg.multicall3, calls); }
    catch (...) { return out; }

    for (std::size_t i = 0; i < cfg.compound_v3_markets.size(); ++i) {
        const auto& m = cfg.compound_v3_markets[i];
        const std::size_t supply_idx = i * 2;
        const std::size_t borrow_idx = i * 2 + 1;

        chain::U256 sup{0}, bor{0};
        if (supply_idx < rs.size() && rs[supply_idx].success) {
            sup = chain::parse_hex_u256(rs[supply_idx].return_data_hex);
        }
        if (borrow_idx < rs.size() && rs[borrow_idx].success) {
            bor = chain::parse_hex_u256(rs[borrow_idx].return_data_hex);
        }

        const auto* tok = find_token(cfg, m.base_address);
        const std::string cgid = tok ? tok->coingecko_id : std::string{};

        if (sup > 0) {
            DefiPosition p;
            p.chain_key = cfg.key; p.chain_name = cfg.name;
            p.protocol = "Compound V3";
            p.kind = "supply";
            p.token0_symbol = m.base_symbol;
            p.token0_address = m.base_address;
            p.decimals0 = m.base_decimals;
            p.token0_coingecko_id = cgid;
            p.amount0_raw = sup;
            std::ostringstream lbl;
            lbl << "Депозит " << m.base_symbol << " (" << m.base_symbol << " market)";
            p.label = lbl.str();
            if (!cfg.explorer.empty()) p.link = cfg.explorer + "/address/" + m.comet.hex();
            out.push_back(std::move(p));
        }
        if (bor > 0) {
            DefiPosition p;
            p.chain_key = cfg.key; p.chain_name = cfg.name;
            p.protocol = "Compound V3";
            p.kind = "borrow";
            p.token0_symbol = m.base_symbol;
            p.token0_address = m.base_address;
            p.decimals0 = m.base_decimals;
            p.token0_coingecko_id = cgid;
            p.amount0_raw = bor;
            p.label = "Долг " + m.base_symbol;
            if (!cfg.explorer.empty()) p.link = cfg.explorer + "/address/" + m.comet.hex();
            out.push_back(std::move(p));
        }
    }
    return out;
}

}  // namespace cryptoapp::defi

#include "cryptoapp/defi/uniswap_v3.hpp"

#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/chain/multicall.hpp"
#include "cryptoapp/defi/uniswap_v3_math.hpp"
#include "cryptoapp/util/hex.hpp"

#include <algorithm>
#include <cstdint>
#include <map>
#include <sstream>
#include <string>
#include <tuple>

namespace cryptoapp::defi {

namespace {

// Selectors:
//   balanceOf(address)                              -> 0x70a08231
//   tokenOfOwnerByIndex(address,uint256)            -> 0x2f745c59
//   positions(uint256)                              -> 0x99fbab88
//   getPool(address,address,uint24)                 -> 0x1698ee82  (UniswapV3Factory)
//   slot0()                                         -> 0x3850c7bd  (UniswapV3Pool)
constexpr const char* SEL_BALANCE_OF              = "70a08231";
constexpr const char* SEL_TOKEN_OF_OWNER_BY_INDEX = "2f745c59";
constexpr const char* SEL_POSITIONS               = "99fbab88";
constexpr const char* SEL_GET_POOL                = "1698ee82";
constexpr const char* SEL_SLOT0                   = "3850c7bd";

// ---------- ABI builders (just what we need) ----------------------------
void append_word_uint256(std::string& out, const chain::U256& v) {
    std::ostringstream os;
    os << std::hex << v;
    std::string s = os.str();
    if (s.size() < 64) out.append(64 - s.size(), '0');
    out.append(s);
}
void append_word_uint(std::string& out, std::uint64_t v) {
    char buf[17];
    std::snprintf(buf, sizeof(buf), "%016llx", static_cast<unsigned long long>(v));
    out.append(48, '0');
    out.append(buf, 16);
}
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
std::string encode_token_of_owner_by_index(const chain::Address& owner, std::uint64_t i) {
    std::string s = "0x";
    s.append(SEL_TOKEN_OF_OWNER_BY_INDEX);
    append_word_address(s, owner);
    append_word_uint(s, i);
    return s;
}
std::string encode_positions(const chain::U256& token_id) {
    std::string s = "0x";
    s.append(SEL_POSITIONS);
    append_word_uint256(s, token_id);
    return s;
}
std::string encode_get_pool(const chain::Address& t0, const chain::Address& t1, std::uint32_t fee) {
    std::string s = "0x";
    s.append(SEL_GET_POOL);
    append_word_address(s, t0);
    append_word_address(s, t1);
    append_word_uint(s, fee);
    return s;
}
std::string encode_slot0() {
    return std::string("0x") + SEL_SLOT0;
}

// ---------- ABI decoders -----------------------------------------------
chain::U256 word_at_u256(std::string_view h_no0x, std::size_t word_idx) {
    const std::size_t pos = word_idx * 64;
    if (pos + 64 > h_no0x.size()) {
        throw std::runtime_error("uniswap_v3: word out of range");
    }
    return chain::parse_hex_u256(std::string("0x") + std::string(h_no0x.substr(pos, 64)));
}
chain::Address word_at_address(std::string_view h_no0x, std::size_t word_idx) {
    const std::size_t pos = word_idx * 64;
    if (pos + 64 > h_no0x.size()) {
        throw std::runtime_error("uniswap_v3: word out of range");
    }
    return chain::Address::from_hex(std::string("0x") + std::string(h_no0x.substr(pos + 24, 40)));
}
std::int32_t parse_int24(const chain::U256& word) {
    const chain::U256 mask = chain::U256{0xFFFFFF};
    const std::uint32_t low = (word & mask).convert_to<std::uint32_t>();
    if (low & 0x800000u) return static_cast<std::int32_t>(low) - 0x1000000;
    return static_cast<std::int32_t>(low);
}

// ---------- Token resolution -------------------------------------------
const chain::TokenInfo* find_token(const chain::ChainConfig& cfg, const chain::Address& addr) {
    for (const auto& t : cfg.tokens) {
        if (t.address == addr) return &t;
    }
    return nullptr;
}
std::string short_addr(const chain::Address& a) {
    auto h = a.hex();
    if (h.size() < 12) return h;
    return h.substr(0, 6) + "…" + h.substr(h.size() - 4);
}
std::string fee_label(std::uint32_t fee_raw) {
    char buf[32];
    if (fee_raw % 100 == 0)
        std::snprintf(buf, sizeof(buf), "%.2g%%", fee_raw / 10000.0);
    else
        std::snprintf(buf, sizeof(buf), "%.4g%%", fee_raw / 10000.0);
    return buf;
}

// Decoded position struct (what we keep after the positions() multicall).
struct RawPosition {
    chain::U256 token_id;
    chain::Address token0;
    chain::Address token1;
    std::uint32_t fee = 0;
    std::int32_t tick_lower = 0;
    std::int32_t tick_upper = 0;
    chain::U256 liquidity{0};
};

}  // namespace

std::vector<DefiPosition> scan_uniswap_v3(chain::RpcClient& rpc,
                                          const chain::ChainConfig& cfg,
                                          const chain::Address& wallet,
                                          std::size_t max_positions) {
    std::vector<DefiPosition> out;
    if (cfg.uniswap_v3_position_manager.is_zero()) return out;

    // Step 1: balanceOf -> NFT count.
    chain::U256 count_u;
    try {
        const auto ret = rpc.eth_call_hex(cfg.uniswap_v3_position_manager,
                                          encode_balance_of(wallet));
        count_u = chain::parse_hex_u256(ret);
    } catch (...) { return out; }

    const std::uint64_t count = std::min<std::uint64_t>(
        count_u.convert_to<std::uint64_t>(), max_positions);
    if (count == 0) return out;

    // Step 2: tokenOfOwnerByIndex multicall.
    std::vector<chain::Call3> idx_calls;
    idx_calls.reserve(count);
    for (std::uint64_t i = 0; i < count; ++i) {
        chain::Call3 c;
        c.target = cfg.uniswap_v3_position_manager;
        c.allow_failure = true;
        c.call_data_hex = encode_token_of_owner_by_index(wallet, i);
        idx_calls.push_back(std::move(c));
    }
    std::vector<chain::U256> token_ids;
    try {
        auto rs = chain::aggregate3(rpc, cfg.multicall3, idx_calls);
        for (auto& r : rs) {
            if (!r.success) continue;
            token_ids.push_back(chain::parse_hex_u256(r.return_data_hex));
        }
    } catch (...) { return out; }
    if (token_ids.empty()) return out;

    // Step 3: positions(tokenId) multicall.
    std::vector<chain::Call3> pos_calls;
    pos_calls.reserve(token_ids.size());
    for (const auto& tid : token_ids) {
        chain::Call3 c;
        c.target = cfg.uniswap_v3_position_manager;
        c.allow_failure = true;
        c.call_data_hex = encode_positions(tid);
        pos_calls.push_back(std::move(c));
    }
    std::vector<chain::Call3Result> pos_rs;
    try {
        pos_rs = chain::aggregate3(rpc, cfg.multicall3, pos_calls);
    } catch (...) { return out; }

    std::vector<RawPosition> raws;
    raws.reserve(pos_rs.size());
    for (std::size_t i = 0; i < pos_rs.size(); ++i) {
        if (!pos_rs[i].success) continue;
        const auto h = util::normalize_hex(pos_rs[i].return_data_hex);
        if (h.size() < 12 * 64) continue;
        RawPosition rp;
        rp.token_id    = token_ids[i];
        rp.token0      = word_at_address(h, 2);
        rp.token1      = word_at_address(h, 3);
        rp.fee         = word_at_u256(h, 4).convert_to<std::uint32_t>();
        rp.tick_lower  = parse_int24(word_at_u256(h, 5));
        rp.tick_upper  = parse_int24(word_at_u256(h, 6));
        rp.liquidity   = word_at_u256(h, 7);
        raws.push_back(std::move(rp));
    }
    if (raws.empty()) return out;

    // Step 4: factory.getPool(token0, token1, fee) — only if we have a factory.
    // Group unique (t0,t1,fee) tuples, do one multicall.
    std::vector<chain::Address> pool_addresses(raws.size());  // index-aligned with raws
    if (!cfg.uniswap_v3_factory.is_zero()) {
        // Map tuple -> index in pool_calls. Tuples deduplicated for efficiency.
        struct Key { std::string t0; std::string t1; std::uint32_t fee; };
        std::map<std::tuple<std::string, std::string, std::uint32_t>, std::size_t> key_to_idx;
        std::vector<chain::Call3> pool_calls;
        std::vector<std::size_t> raw_to_call;  // raw index -> pool_calls index
        raw_to_call.reserve(raws.size());

        for (const auto& rp : raws) {
            auto key = std::make_tuple(rp.token0.hex(), rp.token1.hex(), rp.fee);
            auto it = key_to_idx.find(key);
            std::size_t idx;
            if (it == key_to_idx.end()) {
                idx = pool_calls.size();
                key_to_idx[key] = idx;
                chain::Call3 c;
                c.target = cfg.uniswap_v3_factory;
                c.allow_failure = true;
                c.call_data_hex = encode_get_pool(rp.token0, rp.token1, rp.fee);
                pool_calls.push_back(std::move(c));
            } else {
                idx = it->second;
            }
            raw_to_call.push_back(idx);
        }
        std::vector<chain::Address> unique_pools(pool_calls.size());
        try {
            auto rs = chain::aggregate3(rpc, cfg.multicall3, pool_calls);
            for (std::size_t i = 0; i < rs.size(); ++i) {
                if (!rs[i].success) continue;
                const auto h = util::normalize_hex(rs[i].return_data_hex);
                if (h.size() < 64) continue;
                unique_pools[i] = word_at_address(h, 0);
            }
        } catch (...) { /* leave unique_pools as zeros */ }
        for (std::size_t i = 0; i < raws.size(); ++i) {
            pool_addresses[i] = unique_pools[raw_to_call[i]];
        }
    }

    // Step 5: pool.slot0() multicall — to get sqrtPriceX96 & current tick.
    // We only call slot0 for non-zero pools. Map raw index -> slot0 result index.
    std::vector<chain::U256>     sqrt_prices(raws.size(), chain::U256{0});
    std::vector<std::int32_t>    cur_ticks(raws.size(), 0);
    std::vector<bool>            has_slot0(raws.size(), false);
    {
        std::vector<chain::Call3> slot_calls;
        std::vector<std::size_t> slot_raw_idx;
        slot_calls.reserve(raws.size());
        slot_raw_idx.reserve(raws.size());
        for (std::size_t i = 0; i < raws.size(); ++i) {
            if (pool_addresses[i].is_zero()) continue;
            chain::Call3 c;
            c.target = pool_addresses[i];
            c.allow_failure = true;
            c.call_data_hex = encode_slot0();
            slot_calls.push_back(std::move(c));
            slot_raw_idx.push_back(i);
        }
        if (!slot_calls.empty()) {
            try {
                auto rs = chain::aggregate3(rpc, cfg.multicall3, slot_calls);
                for (std::size_t k = 0; k < rs.size(); ++k) {
                    if (!rs[k].success) continue;
                    const auto h = util::normalize_hex(rs[k].return_data_hex);
                    // slot0 returns (sqrtPriceX96 uint160, tick int24, ...).
                    if (h.size() < 2 * 64) continue;
                    const std::size_t i = slot_raw_idx[k];
                    sqrt_prices[i] = word_at_u256(h, 0);
                    cur_ticks[i]   = parse_int24(word_at_u256(h, 1));
                    has_slot0[i]   = true;
                }
            } catch (...) { /* leave defaults */ }
        }
    }

    // Step 6: assemble DefiPositions, computing amounts when possible.
    for (std::size_t i = 0; i < raws.size(); ++i) {
        const auto& rp = raws[i];
        const auto* t0 = find_token(cfg, rp.token0);
        const auto* t1 = find_token(cfg, rp.token1);
        const std::string sym0 = t0 ? t0->symbol : short_addr(rp.token0);
        const std::string sym1 = t1 ? t1->symbol : short_addr(rp.token1);

        DefiPosition p;
        p.chain_key   = cfg.key;
        p.chain_name  = cfg.name;
        p.protocol    = "Uniswap V3";
        p.kind        = "lp";
        p.token0_symbol = sym0;
        p.token1_symbol = sym1;
        p.token0_address = rp.token0;
        p.token1_address = rp.token1;
        p.decimals0 = t0 ? t0->decimals : 18;
        p.decimals1 = t1 ? t1->decimals : 18;
        p.token0_coingecko_id = t0 ? t0->coingecko_id : std::string{};
        p.token1_coingecko_id = t1 ? t1->coingecko_id : std::string{};

        bool in_range = false;
        if (has_slot0[i] && rp.liquidity != 0) {
            try {
                auto a = univ3::compute_position_amounts(
                    sqrt_prices[i], cur_ticks[i],
                    rp.tick_lower, rp.tick_upper, rp.liquidity);
                p.amount0_raw = a.amount0;
                p.amount1_raw = a.amount1;
                in_range = (cur_ticks[i] >= rp.tick_lower && cur_ticks[i] < rp.tick_upper);
            } catch (...) { /* leave amounts at zero */ }
        }
        p.in_range = in_range;

        std::ostringstream label;
        label << sym0 << " / " << sym1 << " · " << fee_label(rp.fee);
        if (rp.liquidity == 0) {
            label << " (закрыта)";
        } else if (has_slot0[i]) {
            label << (in_range ? " · в диапазоне" : " · вне диапазона");
        }
        p.label = label.str();

        std::ostringstream link;
        link << "https://app.uniswap.org/positions/v3/" << cfg.key << "/"
             << rp.token_id.str();
        p.link = link.str();

        out.push_back(std::move(p));
    }
    return out;
}

}  // namespace cryptoapp::defi

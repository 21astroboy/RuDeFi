#include "cryptoapp/security/approvals.hpp"

#include "cryptoapp/chain/multicall.hpp"
#include "cryptoapp/chain/rpc_client.hpp"
#include "cryptoapp/util/hex.hpp"

#include <algorithm>
#include <future>
#include <map>
#include <vector>

namespace cryptoapp::security {

namespace {

struct SpenderEntry { const char* address; const char* label; };

// Curated list of common DeFi router / aggregator / bridge contracts per chain.
// These are the spenders that get approve() most often by accident and get
// "forgotten" — main attack vector for stolen funds. Adding the user's own
// Aave Pool from registry happens dynamically in scan().
const std::map<std::string, std::vector<SpenderEntry>>& well_known_spenders() {
    static const std::map<std::string, std::vector<SpenderEntry>> M = {
        {"ethereum", {
            {"0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "Uniswap V3 Router 02"},
            {"0xE592427A0AEce92De3Edee1F18E0157C05861564", "Uniswap V3 Router"},
            {"0x3fC91A3afd70395Cd496C647d5a6CC9D4B2b7FAD", "Uniswap Universal Router"},
            {"0x66a9893cC07D91D95644AEDD05D03f95e1dBA8Af", "Uniswap Universal Router v2"},
            {"0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", "Uniswap V2 Router"},
            {"0x1111111254EEB25477B68fb85Ed929f73A960582", "1inch Router v5"},
            {"0x111111125421cA6dc452d289314280a0f8842A65", "1inch Router v6"},
            {"0xDEF1C0ded9bec7F1a1670819833240f027b25EfF", "0x Protocol"},
            {"0x216B4B4Ba9F3e719726886d34a177484278Bfcae", "Paraswap v5"},
            {"0x6A000F20005980200259B80c5102003040001068", "Paraswap v6"},
            {"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "LiFi Diamond"},
            {"0x9008D19f58AAbD9eD0D60971565AA8510560ab41", "CowSwap Settlement"},
            {"0xC36442b4a4522E871399CD717aBDD847Ab11FE88", "Uniswap V3 NFT Manager"},
        }},
        {"arbitrum", {
            {"0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "Uniswap V3 Router 02"},
            {"0xE592427A0AEce92De3Edee1F18E0157C05861564", "Uniswap V3 Router"},
            {"0x5E325eDA8064b456f4781070C0738d849c824258", "Uniswap Universal Router"},
            {"0x1111111254EEB25477B68fb85Ed929f73A960582", "1inch Router v5"},
            {"0x111111125421cA6dc452d289314280a0f8842A65", "1inch Router v6"},
            {"0xDEF171Fe48CF0115B1d80b88dc8eAB59176FEe57", "Paraswap"},
            {"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "LiFi Diamond"},
            {"0x53c6eB1B05E8d45CDA20a4D6c89855B9eDDfa28d", "Camelot Router"},
            {"0xC36442b4a4522E871399CD717aBDD847Ab11FE88", "Uniswap V3 NFT Manager"},
            {"0xb47e6A5f8b33b3F17603C83a0535A9dcD7E32681", "Stargate Router"},
        }},
        {"optimism", {
            {"0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "Uniswap V3 Router 02"},
            {"0xE592427A0AEce92De3Edee1F18E0157C05861564", "Uniswap V3 Router"},
            {"0xCb1355ff08Ab38bBCE60111F1bb2B784bE25D7e8", "Uniswap Universal Router"},
            {"0x1111111254EEB25477B68fb85Ed929f73A960582", "1inch Router v5"},
            {"0x111111125421cA6dc452d289314280a0f8842A65", "1inch Router v6"},
            {"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "LiFi Diamond"},
            {"0x9c12939390052919aF3155f41Bf4160Fd3666A6f", "Velodrome Router"},
            {"0xC36442b4a4522E871399CD717aBDD847Ab11FE88", "Uniswap V3 NFT Manager"},
        }},
        {"base", {
            {"0x2626664c2603336E57B271c5C0b26F421741e481", "Uniswap V3 Router 02"},
            {"0x6fF5693b99212Da76ad316178A184AB56D299b43", "Uniswap Universal Router"},
            {"0x1111111254EEB25477B68fb85Ed929f73A960582", "1inch Router v5"},
            {"0x111111125421cA6dc452d289314280a0f8842A65", "1inch Router v6"},
            {"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "LiFi Diamond"},
            {"0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43", "Aerodrome Router"},
            {"0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1", "Uniswap V3 NFT Manager"},
        }},
        {"polygon", {
            {"0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45", "Uniswap V3 Router 02"},
            {"0xE592427A0AEce92De3Edee1F18E0157C05861564", "Uniswap V3 Router"},
            {"0xec7BE89e9d109e7e3Fec59c222CF297125FEFda2", "Uniswap Universal Router"},
            {"0x1111111254EEB25477B68fb85Ed929f73A960582", "1inch Router v5"},
            {"0x111111125421cA6dc452d289314280a0f8842A65", "1inch Router v6"},
            {"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "LiFi Diamond"},
            {"0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff", "QuickSwap Router"},
            {"0xC36442b4a4522E871399CD717aBDD847Ab11FE88", "Uniswap V3 NFT Manager"},
        }},
        {"bnb", {
            {"0x10ED43C718714eb63d5aA57B78B54704E256024E", "PancakeSwap V2 Router"},
            {"0x13f4EA83D0bd40E75C8222255bc855a974568Dd4", "PancakeSwap V3 Router"},
            {"0x1111111254EEB25477B68fb85Ed929f73A960582", "1inch Router v5"},
            {"0x111111125421cA6dc452d289314280a0f8842A65", "1inch Router v6"},
            {"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "LiFi Diamond"},
        }},
        {"avalanche", {
            {"0x60aE616a2155Ee3d9A68541Ba4544862310933d4", "Trader Joe Router"},
            {"0xbb00FF08d01D300023C629E8fFfFcb65A5a578cE", "Trader Joe V2.1"},
            {"0x1111111254EEB25477B68fb85Ed929f73A960582", "1inch Router v5"},
            {"0x111111125421cA6dc452d289314280a0f8842A65", "1inch Router v6"},
            {"0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", "LiFi Diamond"},
        }},
    };
    return M;
}

// Selector keccak256("allowance(address,address)")[:4] = 0xdd62ed3e
constexpr const char* SEL_ALLOWANCE = "dd62ed3e";

std::string encode_allowance(const chain::Address& owner, const chain::Address& spender) {
    std::string s = "0x";
    s.append(SEL_ALLOWANCE);
    s.append(24, '0');
    auto oh = util::hex_encode(owner.bytes().data(), owner.bytes().size());
    s.append(oh, 2, std::string::npos);
    s.append(24, '0');
    auto sh = util::hex_encode(spender.bytes().data(), spender.bytes().size());
    s.append(sh, 2, std::string::npos);
    return s;
}

// 2^256 - 1 — what most DApps approve when they want infinite spend.
// Anything within ~10% of MAX we treat as "unlimited" for display.
bool is_unlimited(const chain::U256& v) {
    static const chain::U256 MAX = (chain::U256{1} << 256) - 1;
    static const chain::U256 THRESHOLD = MAX - (MAX / 1000);  // 99.9% of MAX
    return v >= THRESHOLD;
}

struct ChainScanResult {
    std::vector<Approval> approvals;
};

ChainScanResult scan_one_chain(const chain::ChainConfig& cfg,
                               const chain::Address& wallet,
                               std::shared_ptr<util::HttpClient> http) {
    ChainScanResult out;
    if (cfg.tokens.empty()) return out;

    // Build the spender list for this chain: known spenders + Aave Pool.
    std::vector<std::pair<chain::Address, std::string>> spenders;
    const auto& M = well_known_spenders();
    auto it = M.find(cfg.key);
    if (it != M.end()) {
        for (const auto& s : it->second) {
            try {
                spenders.emplace_back(chain::Address::from_hex(s.address), s.label);
            } catch (...) { /* ignore bad hex in our config */ }
        }
    }
    if (!cfg.aave_v3_pool.is_zero()) spenders.emplace_back(cfg.aave_v3_pool, "Aave V3 Pool");
    if (!cfg.uniswap_v3_position_manager.is_zero())
        spenders.emplace_back(cfg.uniswap_v3_position_manager, "Uniswap V3 Position Mgr");

    if (spenders.empty()) return out;

    // Build the multicall: for each (token, spender), allowance(owner, spender).
    std::vector<chain::Call3> calls;
    calls.reserve(cfg.tokens.size() * spenders.size());
    for (const auto& t : cfg.tokens) {
        for (const auto& sp : spenders) {
            chain::Call3 c;
            c.target = t.address;
            c.allow_failure = true;
            c.call_data_hex = encode_allowance(wallet, sp.first);
            calls.push_back(std::move(c));
        }
    }

    chain::RpcClient rpc(cfg.rpc_urls, http);
    std::vector<chain::Call3Result> results;
    try {
        results = chain::aggregate3(rpc, cfg.multicall3, calls);
    } catch (...) { return out; }

    // Decode and filter non-zero allowances.
    std::size_t k = 0;
    for (const auto& t : cfg.tokens) {
        for (const auto& sp : spenders) {
            if (k >= results.size()) break;
            const auto& r = results[k++];
            if (!r.success) continue;
            chain::U256 al = chain::parse_hex_u256(r.return_data_hex);
            if (al == 0) continue;
            Approval a;
            a.chain_key = cfg.key;
            a.chain_name = cfg.name;
            a.token_symbol = t.symbol;
            a.token_address = t.address;
            a.token_decimals = t.decimals;
            a.spender_label = sp.second;
            a.spender_address = sp.first;
            a.allowance_raw = al;
            a.unlimited = is_unlimited(al);
            a.allowance_human = a.unlimited
                ? std::string{"unlimited"}
                : chain::format_units(al, t.decimals, 6);
            out.approvals.push_back(std::move(a));
        }
    }
    return out;
}

}  // namespace

ApprovalScanner::ApprovalScanner(const chain::Registry& registry,
                                 std::shared_ptr<util::HttpClient> http)
    : registry_(registry), http_(std::move(http)) {}

std::vector<Approval> ApprovalScanner::scan(const chain::Address& wallet,
                                            const ApprovalScanOptions& opts) {
    const auto& chains = registry_.chains();
    std::vector<Approval> all;

    int conc = std::max(1, opts.concurrency);
    for (std::size_t i = 0; i < chains.size(); i += static_cast<std::size_t>(conc)) {
        std::size_t end = std::min(chains.size(), i + static_cast<std::size_t>(conc));
        std::vector<std::future<ChainScanResult>> futs;
        for (std::size_t j = i; j < end; ++j) {
            const auto& cfg = chains[j];
            futs.push_back(std::async(std::launch::async, [&cfg, &wallet, this]() {
                return scan_one_chain(cfg, wallet, http_);
            }));
        }
        for (auto& f : futs) {
            auto r = f.get();
            for (auto& a : r.approvals) all.push_back(std::move(a));
        }
    }

    // Sort: chain → token → unlimited first.
    std::sort(all.begin(), all.end(), [](const Approval& a, const Approval& b) {
        if (a.chain_key != b.chain_key) return a.chain_key < b.chain_key;
        if (a.token_symbol != b.token_symbol) return a.token_symbol < b.token_symbol;
        return a.unlimited > b.unlimited;
    });
    return all;
}

}  // namespace cryptoapp::security

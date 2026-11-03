// llama_client.hpp - DeFiLlama Yields scanner.
//
// We fetch the full /pools list (~5–7 MB JSON, 10k+ pools), parse once and
// cache in memory. Subsequent scans filter the parsed slice by symbol, chain,
// minimum TVL/APY, etc. Free, no API key.
#pragma once

#include "cryptoapp/util/http.hpp"

#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <set>
#include <string>
#include <vector>

namespace cryptoapp::yield {

struct YieldPool {
    std::string chain_key;        // mapped to our 7 EVM chains; others dropped
    std::string project;          // "aave-v3", "curve", "uniswap-v3", ...
    std::string symbol;           // "USDC" or "USDC-WETH" or "stETH"
    std::string pool_id;          // DeFiLlama pool id (UUID-ish)
    double tvl_usd = 0;
    double apy = 0;               // total APY (base + reward)
    double apy_base = 0;          // pure interest / fees
    double apy_reward = 0;        // governance-token incentives
    double apy_mean_30d = 0;      // 30-day mean (more stable than spot)
    bool stablecoin = false;      // pure stable pool
    std::string il_risk;          // "no" | "yes"
    std::string exposure;         // "single" | "multi"
};

struct YieldQuery {
    std::set<std::string> symbols;     // case-insensitive; empty = no filter
    std::set<std::string> chain_keys;  // empty = no filter
    double min_tvl_usd = 0;
    double min_apy_pct = 0;
    bool stable_only = false;
    bool single_exposure_only = false; // skip LP-style (multi) pools
    bool no_il_only = false;
    int max_results = 200;
};

class LlamaClient {
public:
    explicit LlamaClient(std::shared_ptr<util::HttpClient> http,
                         std::chrono::seconds cache_ttl = std::chrono::seconds(600));

    [[nodiscard]] std::vector<YieldPool> scan(const YieldQuery& q);

    // Number of pools currently cached (after parsing). 0 if nothing fetched yet.
    [[nodiscard]] std::size_t cache_size();

private:
    void ensure_cached_();   // refreshes if TTL expired

    std::shared_ptr<util::HttpClient> http_;
    std::chrono::seconds ttl_;
    std::vector<YieldPool> cached_;
    std::chrono::steady_clock::time_point cached_at_{};
    std::mutex mtx_;
};

}  // namespace cryptoapp::yield

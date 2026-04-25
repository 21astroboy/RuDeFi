// lifi_client.hpp - Wrapper around LiFi's /v1/advanced/routes endpoint.
//
// LiFi (https://li.quest) is a free public bridge aggregator. It returns
// route candidates spanning >25 bridges and >15 chains, ranked by net output,
// time, and fees. We use it to produce the "best route" comparison UI.
#pragma once

#include "cryptoapp/util/http.hpp"

#include <nlohmann/json.hpp>

#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

namespace cryptoapp::bridges {

struct GasCost {
    std::string token_symbol;
    std::uint8_t token_decimals = 18;
    std::string amount_raw;       // wei (as decimal string)
    double amount_human = 0;      // converted via decimals
    double amount_usd = 0;        // LiFi gives this directly
};

struct BridgeStep {
    std::string protocol;         // "stargate", "across", "hop", ...
    std::string protocol_logo;    // URL
};

struct BridgeRoute {
    std::string id;
    std::vector<BridgeStep> steps;
    std::string from_token_symbol;
    std::string to_token_symbol;
    std::uint8_t from_decimals = 18;
    std::uint8_t to_decimals = 18;
    std::string from_amount_raw;
    std::string to_amount_raw;
    double from_amount_human = 0;
    double to_amount_human = 0;
    double from_amount_usd = 0;
    double to_amount_usd = 0;
    int execution_duration_seconds = 0;
    double total_gas_usd = 0;
    std::vector<GasCost> gas_breakdown;
    std::vector<std::string> tags;   // RECOMMENDED, CHEAPEST, FASTEST, SAFEST
};

struct BridgeQuoteRequest {
    std::uint64_t from_chain_id = 0;
    std::uint64_t to_chain_id = 0;
    std::string from_token;       // 0x... (native = 0xeeee...)
    std::string to_token;
    std::string from_amount;      // raw integer string
    std::string from_address;
    double slippage = 0.005;      // 0.5%
};

struct BridgeQuoteResult {
    std::vector<BridgeRoute> routes;
    std::string error;            // empty on success
};

class LifiClient {
public:
    explicit LifiClient(std::shared_ptr<util::HttpClient> http);

    [[nodiscard]] BridgeQuoteResult get_routes(const BridgeQuoteRequest& req);

    // After get_routes() the full LiFi route blobs are cached here keyed by
    // route id so /api/bridge/build-tx can look them up later. Cache entry
    // lives for ~5 minutes (LiFi quotes go stale quickly).
    //
    // Returns the LiFi /v1/advanced/stepTransaction response for a given step.
    // On error: returns an empty JSON object and sets `error_out`.
    [[nodiscard]] nlohmann::json build_step_transaction(const std::string& route_id,
                                                       std::size_t step_index,
                                                       std::string& error_out);

    // Proxies LiFi /v1/status. Used to poll cross-chain progress after we've
    // sent the bridge transaction on the source chain.
    [[nodiscard]] nlohmann::json get_status(const std::string& bridge,
                                            std::uint64_t from_chain_id,
                                            std::uint64_t to_chain_id,
                                            const std::string& tx_hash,
                                            std::string& error_out);

private:
    std::shared_ptr<util::HttpClient> http_;

    struct CachedRoute {
        nlohmann::json raw;
        std::chrono::steady_clock::time_point at;
    };
    std::unordered_map<std::string, CachedRoute> route_cache_;
    std::mutex route_cache_mtx_;
    std::chrono::seconds cache_ttl_{300};
};

}  // namespace cryptoapp::bridges

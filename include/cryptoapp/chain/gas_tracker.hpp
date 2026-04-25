// gas_tracker.hpp - Snapshot of current gas prices across all configured chains.
//
// Updates with a TTL cache so the UI's auto-refresh doesn't hammer RPCs.
#pragma once

#include "cryptoapp/chain/chain_config.hpp"
#include "cryptoapp/util/http.hpp"

#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace cryptoapp::chain {

struct GasInfo {
    std::string chain_key;
    std::string chain_name;
    std::string native_symbol;
    double gwei = 0;        // gas price in gwei (wei / 10^9)
    std::string level;      // "low" | "medium" | "high" | "unknown"
    std::string error;      // populated on RPC failure
};

class GasTracker {
public:
    GasTracker(const Registry& registry,
               std::shared_ptr<util::HttpClient> http,
               std::chrono::seconds cache_ttl = std::chrono::seconds(15));

    [[nodiscard]] std::vector<GasInfo> snapshot();

private:
    const Registry& registry_;
    std::shared_ptr<util::HttpClient> http_;
    std::chrono::seconds ttl_;
    std::vector<GasInfo> cached_;
    std::chrono::steady_clock::time_point cached_at_{};
    std::mutex mtx_;
};

}  // namespace cryptoapp::chain

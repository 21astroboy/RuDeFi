// price_service.hpp - USD prices for tokens.
//
// Default backend: CoinGecko's /simple/price endpoint (free, public).
// Designed to swap in Chainlink on-chain feeds later for sub-second freshness.
#pragma once

#include "cryptoapp/util/http.hpp"

#include <chrono>
#include <memory>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace cryptoapp::pricing {

class PriceService {
public:
    explicit PriceService(std::shared_ptr<util::HttpClient> http,
                          std::string api_key = "",
                          std::chrono::seconds cache_ttl = std::chrono::seconds(120));

    // Look up multiple coingecko ids -> USD price. Missing ids are absent in the result.
    [[nodiscard]] std::unordered_map<std::string, double>
    usd_prices(const std::vector<std::string>& coingecko_ids);

    // Convenience: single id.
    [[nodiscard]] std::optional<double> usd_price(const std::string& coingecko_id);

    // Drop the in-memory cache (e.g. for forced refresh).
    void clear_cache();

private:
    std::shared_ptr<util::HttpClient> http_;
    std::string api_key_;
    std::chrono::seconds ttl_;
    struct CacheEntry { double usd = 0; std::chrono::steady_clock::time_point at; };
    std::unordered_map<std::string, CacheEntry> cache_;
};

}  // namespace cryptoapp::pricing

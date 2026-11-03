// fx_service.hpp - USD <-> RUB conversion using the Russian Central Bank daily feed.
//
// CBR publishes a daily XML at https://www.cbr-xml-daily.ru/daily_json.js (mirrors
// the official cbr.ru rate). It's free, public, and updates once per day —
// good enough for displaying portfolio value in RUB.
#pragma once

#include "cryptoapp/util/http.hpp"

#include <chrono>
#include <memory>
#include <optional>

namespace cryptoapp::pricing {

class FxService {
public:
    explicit FxService(std::shared_ptr<util::HttpClient> http,
                       std::chrono::minutes cache_ttl = std::chrono::minutes(60));

    // Returns the number of RUB per 1 USD (e.g. 92.5).
    [[nodiscard]] std::optional<double> usd_to_rub();

private:
    std::shared_ptr<util::HttpClient> http_;
    std::chrono::minutes ttl_;
    std::optional<double> cached_;
    std::chrono::steady_clock::time_point cached_at_{};
};

}  // namespace cryptoapp::pricing

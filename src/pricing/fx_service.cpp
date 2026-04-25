#include "cryptoapp/pricing/fx_service.hpp"

#include <nlohmann/json.hpp>

namespace cryptoapp::pricing {

FxService::FxService(std::shared_ptr<util::HttpClient> http,
                     std::chrono::minutes cache_ttl)
    : http_(std::move(http)), ttl_(cache_ttl) {}

std::optional<double> FxService::usd_to_rub() {
    const auto now = std::chrono::steady_clock::now();

    // If we have a fresh cached value, hand it back without a network round-trip.
    if (cached_ && now - cached_at_ < ttl_) return cached_;

    auto resp = http_->get("https://www.cbr-xml-daily.ru/daily_json.js");
    if (resp.ok()) {
        try {
            auto j = nlohmann::json::parse(resp.body);
            if (j.contains("Valute") && j["Valute"].contains("USD")) {
                const auto& usd = j["Valute"]["USD"];
                const double v = usd.value("Value", 0.0);
                const double n = usd.value("Nominal", 1.0);
                if (n > 0 && v > 0) {
                    cached_ = v / n;
                    cached_at_ = now;
                    return cached_;
                }
            }
        } catch (...) { /* fall through */ }
    }

    // Stale fallback: rate sources fail, but the rate barely changes day-to-day.
    // Returning a stale value is far better than dropping all RUB displays.
    return cached_;  // already optional<double>; nullopt only on first-ever failure
}

}  // namespace cryptoapp::pricing

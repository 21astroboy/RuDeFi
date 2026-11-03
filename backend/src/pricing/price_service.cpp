#include "cryptoapp/pricing/price_service.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <set>
#include <sstream>
#include <stdexcept>

namespace cryptoapp::pricing {

PriceService::PriceService(std::shared_ptr<util::HttpClient> http,
                           std::string api_key,
                           std::chrono::seconds cache_ttl)
    : http_(std::move(http)), api_key_(std::move(api_key)), ttl_(cache_ttl) {}

void PriceService::clear_cache() { cache_.clear(); }

std::unordered_map<std::string, double>
PriceService::usd_prices(const std::vector<std::string>& coingecko_ids) {
    std::unordered_map<std::string, double> out;
    if (coingecko_ids.empty()) return out;

    const auto now = std::chrono::steady_clock::now();

    // Pass 1: serve fresh cache hits, list missing/stale ids for refresh.
    std::set<std::string> to_fetch;
    for (const auto& id : coingecko_ids) {
        if (id.empty()) continue;
        auto it = cache_.find(id);
        if (it != cache_.end() && now - it->second.at < ttl_) {
            out[id] = it->second.usd;
        } else {
            to_fetch.insert(id);
        }
    }
    if (to_fetch.empty()) return out;

    // Build URL: /api/v3/simple/price?ids=a,b,c&vs_currencies=usd
    std::ostringstream url;
    if (!api_key_.empty()) {
        url << "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd"
            << "&x_cg_demo_api_key=" << api_key_ << "&ids=";
    } else {
        url << "https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=";
    }
    bool first = true;
    for (const auto& id : to_fetch) {
        if (!first) url << ',';
        first = false;
        // CoinGecko ids are URL-safe (lowercase a-z, digits, dashes).
        url << id;
    }

    bool fetch_ok = false;
    nlohmann::json j;
    auto resp = http_->get(url.str());
    if (resp.ok()) {
        try {
            j = nlohmann::json::parse(resp.body);
            fetch_ok = j.is_object();
        } catch (...) { fetch_ok = false; }
    }

    if (fetch_ok) {
        for (auto it = j.begin(); it != j.end(); ++it) {
            const std::string& id = it.key();
            if (!it.value().is_object() || !it.value().contains("usd")) continue;
            const auto& usdv = it.value()["usd"];
            if (!usdv.is_number()) continue;
            const double v = usdv.get<double>();
            out[id] = v;
            cache_[id] = {v, now};
        }
    }

    // Pass 2: stale fallback. Anything still missing — fall back to the last
    // value we ever saw, even if it's older than TTL. Better to display a few
    // minutes-old price than zero everywhere when CoinGecko hiccups.
    for (const auto& id : to_fetch) {
        if (out.count(id)) continue;
        auto it = cache_.find(id);
        if (it != cache_.end()) out[id] = it->second.usd;
    }
    return out;
}

std::optional<double> PriceService::usd_price(const std::string& coingecko_id) {
    auto m = usd_prices({coingecko_id});
    auto it = m.find(coingecko_id);
    if (it == m.end()) return std::nullopt;
    return it->second;
}

}  // namespace cryptoapp::pricing

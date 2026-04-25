#include "cryptoapp/bridges/lifi_client.hpp"

#include <nlohmann/json.hpp>

#include <chrono>
#include <cmath>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>

namespace cryptoapp::bridges {

namespace {

double safe_stod(const std::string& s) {
    if (s.empty()) return 0;
    try { return std::stod(s); } catch (...) { return 0; }
}
double safe_to_double(const nlohmann::json& v) {
    if (v.is_number()) return v.get<double>();
    if (v.is_string()) return safe_stod(v.get<std::string>());
    return 0;
}
std::string safe_to_string(const nlohmann::json& v) {
    if (v.is_string()) return v.get<std::string>();
    if (v.is_number_integer()) return std::to_string(v.get<long long>());
    if (v.is_number_float()) return std::to_string(v.get<double>());
    return {};
}

// Convert a raw integer string like "1234500000" with `decimals=6` into 12.345.
// Stays in double — fine for display, not for transactions.
double scale_raw(const std::string& raw, std::uint8_t decimals) {
    if (raw.empty()) return 0;
    // Plain double parse + division by 10^decimals.
    try {
        double v = std::stod(raw);
        return v / std::pow(10.0, static_cast<double>(decimals));
    } catch (...) { return 0; }
}

}  // namespace

LifiClient::LifiClient(std::shared_ptr<util::HttpClient> http) : http_(std::move(http)) {}

BridgeQuoteResult LifiClient::get_routes(const BridgeQuoteRequest& req) {
    BridgeQuoteResult out;

    nlohmann::json body = {
        {"fromChainId", req.from_chain_id},
        {"toChainId", req.to_chain_id},
        {"fromTokenAddress", req.from_token},
        {"toTokenAddress", req.to_token},
        {"fromAmount", req.from_amount},
        {"fromAddress", req.from_address},
        {"options", {
            {"slippage", req.slippage},
            {"order", "RECOMMENDED"},
        }},
    };

    auto resp = http_->post_json("https://li.quest/v1/advanced/routes", body.dump());
    if (!resp.ok()) {
        out.error = "LiFi HTTP " + std::to_string(resp.status) +
                    (resp.error.empty() ? std::string{} : " — " + resp.error);
        if (!resp.body.empty()) {
            // Surface the upstream message if it parsed as JSON.
            try {
                auto j = nlohmann::json::parse(resp.body);
                if (j.contains("message"))
                    out.error += ": " + j["message"].get<std::string>();
            } catch (...) {
                // Fall back to first 200 chars of raw body.
                out.error += ": " + resp.body.substr(0, 200);
            }
        }
        return out;
    }

    nlohmann::json j;
    try { j = nlohmann::json::parse(resp.body); }
    catch (const std::exception& e) {
        out.error = std::string("LiFi parse error: ") + e.what();
        return out;
    }

    if (!j.contains("routes") || !j["routes"].is_array()) {
        out.error = "LiFi: response missing routes array";
        return out;
    }

    // Cache the full LiFi route blobs so we can later fetch transaction data
    // for a chosen route without round-tripping the entire quote. Mutex
    // protects against concurrent quote requests from different sessions.
    {
        const auto now = std::chrono::steady_clock::now();
        std::lock_guard<std::mutex> lk(route_cache_mtx_);
        // Drop stale entries opportunistically.
        for (auto it = route_cache_.begin(); it != route_cache_.end(); ) {
            if (now - it->second.at > cache_ttl_) it = route_cache_.erase(it);
            else ++it;
        }
        for (const auto& r : j["routes"]) {
            const std::string id = r.value("id", "");
            if (id.empty()) continue;
            route_cache_[id] = CachedRoute{r, now};
        }
    }

    for (const auto& r : j["routes"]) {
        BridgeRoute br;
        br.id = r.value("id", "");

        if (r.contains("fromAmount"))    br.from_amount_raw = safe_to_string(r["fromAmount"]);
        if (r.contains("toAmount"))      br.to_amount_raw   = safe_to_string(r["toAmount"]);
        if (r.contains("fromAmountUSD")) br.from_amount_usd = safe_to_double(r["fromAmountUSD"]);
        if (r.contains("toAmountUSD"))   br.to_amount_usd   = safe_to_double(r["toAmountUSD"]);
        if (r.contains("gasCostUSD"))    br.total_gas_usd   = safe_to_double(r["gasCostUSD"]);

        if (r.contains("fromToken") && r["fromToken"].is_object()) {
            br.from_token_symbol = r["fromToken"].value("symbol", "");
            br.from_decimals     = r["fromToken"].value("decimals", 18);
        }
        if (r.contains("toToken") && r["toToken"].is_object()) {
            br.to_token_symbol   = r["toToken"].value("symbol", "");
            br.to_decimals       = r["toToken"].value("decimals", 18);
        }
        br.from_amount_human = scale_raw(br.from_amount_raw, br.from_decimals);
        br.to_amount_human   = scale_raw(br.to_amount_raw,   br.to_decimals);

        if (r.contains("tags") && r["tags"].is_array()) {
            for (const auto& t : r["tags"]) {
                if (t.is_string()) br.tags.push_back(t.get<std::string>());
            }
        }

        if (r.contains("steps") && r["steps"].is_array()) {
            int total_dur = 0;
            for (const auto& s : r["steps"]) {
                BridgeStep step;
                if (s.contains("toolDetails") && s["toolDetails"].is_object()) {
                    step.protocol      = s["toolDetails"].value("name", "");
                    step.protocol_logo = s["toolDetails"].value("logoURI", "");
                } else {
                    step.protocol = s.value("tool", "");
                }
                br.steps.push_back(std::move(step));

                if (s.contains("estimate") && s["estimate"].is_object()) {
                    total_dur += s["estimate"].value("executionDuration", 0);
                    if (s["estimate"].contains("gasCosts") &&
                        s["estimate"]["gasCosts"].is_array()) {
                        for (const auto& g : s["estimate"]["gasCosts"]) {
                            GasCost gc;
                            if (g.contains("token") && g["token"].is_object()) {
                                gc.token_symbol   = g["token"].value("symbol", "");
                                gc.token_decimals = g["token"].value("decimals", 18);
                            }
                            if (g.contains("amount"))
                                gc.amount_raw = safe_to_string(g["amount"]);
                            if (g.contains("amountUSD"))
                                gc.amount_usd = safe_to_double(g["amountUSD"]);
                            gc.amount_human = scale_raw(gc.amount_raw, gc.token_decimals);
                            br.gas_breakdown.push_back(std::move(gc));
                        }
                    }
                }
            }
            br.execution_duration_seconds = total_dur;
        }

        out.routes.push_back(std::move(br));
    }
    return out;
}

nlohmann::json LifiClient::build_step_transaction(const std::string& route_id,
                                                  std::size_t step_index,
                                                  std::string& error_out) {
    nlohmann::json step_json;
    {
        std::lock_guard<std::mutex> lk(route_cache_mtx_);
        auto it = route_cache_.find(route_id);
        if (it == route_cache_.end()) {
            error_out = "route not found in cache (re-run quote — LiFi routes "
                        "expire after ~5 min)";
            return {};
        }
        if (std::chrono::steady_clock::now() - it->second.at > cache_ttl_) {
            route_cache_.erase(it);
            error_out = "route expired — re-run quote";
            return {};
        }
        const auto& route = it->second.raw;
        if (!route.contains("steps") || !route["steps"].is_array() ||
            step_index >= route["steps"].size()) {
            error_out = "step index out of range";
            return {};
        }
        step_json = route["steps"][step_index];
    }

    // POST the step JSON to LiFi's /v1/advanced/stepTransaction.
    auto resp = http_->post_json("https://li.quest/v1/advanced/stepTransaction",
                                 step_json.dump());
    if (!resp.ok()) {
        error_out = "LiFi HTTP " + std::to_string(resp.status) +
                    (resp.error.empty() ? std::string{} : " — " + resp.error);
        if (!resp.body.empty()) {
            try {
                auto j = nlohmann::json::parse(resp.body);
                if (j.contains("message"))
                    error_out += ": " + j["message"].get<std::string>();
            } catch (...) {
                error_out += ": " + resp.body.substr(0, 200);
            }
        }
        return {};
    }
    nlohmann::json j;
    try { j = nlohmann::json::parse(resp.body); }
    catch (const std::exception& e) {
        error_out = std::string("LiFi parse error: ") + e.what();
        return {};
    }
    return j;
}

nlohmann::json LifiClient::get_status(const std::string& bridge,
                                      std::uint64_t from_chain_id,
                                      std::uint64_t to_chain_id,
                                      const std::string& tx_hash,
                                      std::string& error_out) {
    std::ostringstream url;
    url << "https://li.quest/v1/status?txHash=" << tx_hash;
    if (!bridge.empty()) url << "&bridge=" << bridge;
    if (from_chain_id) url << "&fromChain=" << from_chain_id;
    if (to_chain_id)   url << "&toChain="   << to_chain_id;

    auto resp = http_->get(url.str());
    if (!resp.ok()) {
        error_out = "LiFi HTTP " + std::to_string(resp.status);
        return {};
    }
    nlohmann::json j;
    try { j = nlohmann::json::parse(resp.body); }
    catch (...) {
        error_out = "LiFi status parse error";
        return {};
    }
    return j;
}

}  // namespace cryptoapp::bridges

#include "cryptoapp/chain/gas_tracker.hpp"

#include "cryptoapp/chain/rpc_client.hpp"

#include <future>

namespace cryptoapp::chain {

namespace {

// Per-chain "feels expensive" thresholds. Calibrated for typical 2024–2026
// market: Ethereum mainnet is the only chain where gas is meaningful; on L2s
// and sidechains anything under a single gwei is normal.
struct Thresholds { double low_max; double med_max; };
Thresholds thresholds_for(const std::string& key) {
    if (key == "ethereum")  return { 15.0,  50.0 };
    if (key == "bnb")       return { 2.0,    5.0 };
    if (key == "polygon")   return { 50.0, 150.0 };
    if (key == "avalanche") return { 30.0,  80.0 };
    // L2 rollups: Arbitrum, Optimism, Base.
    return { 0.05, 0.5 };
}

std::string level_for(const std::string& chain_key, double gwei) {
    auto t = thresholds_for(chain_key);
    if (gwei <= t.low_max) return "low";
    if (gwei <= t.med_max) return "medium";
    return "high";
}

}  // namespace

GasTracker::GasTracker(const Registry& registry,
                       std::shared_ptr<util::HttpClient> http,
                       std::chrono::seconds cache_ttl)
    : registry_(registry), http_(std::move(http)), ttl_(cache_ttl) {}

std::vector<GasInfo> GasTracker::snapshot() {
    const auto now = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lk(mtx_);
        if (!cached_.empty() && now - cached_at_ < ttl_) return cached_;
    }

    const auto& chains = registry_.chains();
    std::vector<std::future<GasInfo>> futs;
    futs.reserve(chains.size());

    for (const auto& cfg : chains) {
        futs.push_back(std::async(std::launch::async, [&cfg, this]() -> GasInfo {
            GasInfo info;
            info.chain_key = cfg.key;
            info.chain_name = cfg.name;
            info.native_symbol = cfg.native_symbol;
            try {
                RpcClient rpc(cfg.rpc_urls, http_);
                const auto wei = rpc.eth_gas_price();
                // 1 gwei = 1e9 wei. We carry doubles for the UI; precision is fine.
                info.gwei = wei.convert_to<double>() / 1e9;
                info.level = level_for(cfg.key, info.gwei);
            } catch (const std::exception& e) {
                info.error = e.what();
                info.level = "unknown";
            }
            return info;
        }));
    }

    std::vector<GasInfo> result;
    result.reserve(chains.size());
    const auto deadline = now + std::chrono::seconds(6);
    for (std::size_t i = 0; i < futs.size(); ++i) {
        if (futs[i].wait_until(deadline) == std::future_status::ready) {
            result.push_back(futs[i].get());
        } else {
            GasInfo info;
            info.chain_key    = chains[i].key;
            info.chain_name   = chains[i].name;
            info.native_symbol = chains[i].native_symbol;
            info.error        = "timeout";
            info.level        = "unknown";
            result.push_back(std::move(info));
        }
    }

    std::lock_guard<std::mutex> lk(mtx_);
    cached_ = result;
    cached_at_ = now;
    return result;
}

}  // namespace cryptoapp::chain

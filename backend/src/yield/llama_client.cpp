#include "cryptoapp/yield/llama_client.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>
#include <map>

namespace cryptoapp::yield {

namespace {

// DeFiLlama uses these chain names; map them to our chain keys. Anything not
// listed (Solana, Tron, Cosmos, Fantom, etc.) is silently dropped — we can
// only show pools the user could plausibly enter from the wallets we support.
const std::map<std::string, std::string>& chain_name_map() {
    static const std::map<std::string, std::string> M = {
        {"Ethereum",  "ethereum"},
        {"Arbitrum",  "arbitrum"},
        {"Optimism",  "optimism"},
        {"Base",      "base"},
        {"Polygon",   "polygon"},
        {"BSC",       "bnb"},
        {"Binance",   "bnb"},        // some entries use "Binance"
        {"Avalanche", "avalanche"},
    };
    return M;
}

std::string upper(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return s;
}

// Split DeFiLlama pool symbol like "USDC-WETH" / "USDC+USDT" / "USDC/USDT" into
// component tokens. We accept several separators because DeFiLlama isn't
// fully consistent across protocols.
std::vector<std::string> split_pool_symbol(const std::string& s) {
    std::vector<std::string> out;
    std::string cur;
    for (char c : s) {
        if (c == '-' || c == '+' || c == '/' || c == ' ') {
            if (!cur.empty()) { out.push_back(cur); cur.clear(); }
        } else {
            cur.push_back(c);
        }
    }
    if (!cur.empty()) out.push_back(cur);
    return out;
}

bool symbol_matches(const std::string& pool_symbol,
                    const std::set<std::string>& wanted_upper) {
    if (wanted_upper.empty()) return true;
    auto parts = split_pool_symbol(pool_symbol);
    for (auto& p : parts) {
        if (wanted_upper.count(upper(p))) return true;
    }
    return false;
}

double safe_num(const nlohmann::json& v) {
    if (v.is_number()) return v.get<double>();
    if (v.is_string()) {
        try { return std::stod(v.get<std::string>()); } catch (...) {}
    }
    return 0.0;
}

}  // namespace

LlamaClient::LlamaClient(std::shared_ptr<util::HttpClient> http,
                         std::chrono::seconds cache_ttl)
    : http_(std::move(http)), ttl_(cache_ttl) {}

std::size_t LlamaClient::cache_size() {
    std::lock_guard<std::mutex> lk(mtx_);
    return cached_.size();
}

void LlamaClient::ensure_cached_() {
    const auto now = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lk(mtx_);
        if (!cached_.empty() && now - cached_at_ < ttl_) return;
    }

    auto resp = http_->get("https://yields.llama.fi/pools");
    if (!resp.ok()) {
        // Keep stale cache (better stale than empty); the user will see the
        // existing list rather than an error.
        return;
    }
    nlohmann::json j;
    try { j = nlohmann::json::parse(resp.body); }
    catch (...) { return; }
    if (!j.contains("data") || !j["data"].is_array()) return;

    const auto& M = chain_name_map();

    std::vector<YieldPool> next;
    next.reserve(j["data"].size());

    for (const auto& p : j["data"]) {
        const std::string chain = p.value("chain", "");
        auto it = M.find(chain);
        if (it == M.end()) continue;

        YieldPool pool;
        pool.chain_key   = it->second;
        pool.project     = p.value("project", "");
        pool.symbol      = p.value("symbol", "");
        pool.pool_id     = p.value("pool", "");
        pool.tvl_usd     = safe_num(p.value("tvlUsd", nlohmann::json(0)));
        pool.apy         = safe_num(p.value("apy",  nlohmann::json(0)));
        pool.apy_base    = safe_num(p.value("apyBase", nlohmann::json(0)));
        pool.apy_reward  = safe_num(p.value("apyReward", nlohmann::json(0)));
        pool.apy_mean_30d= safe_num(p.value("apyMean30d", nlohmann::json(0)));
        pool.stablecoin  = p.value("stablecoin", false);
        pool.il_risk     = p.value("ilRisk", "");
        pool.exposure    = p.value("exposure", "");
        next.push_back(std::move(pool));
    }

    {
        std::lock_guard<std::mutex> lk(mtx_);
        cached_ = std::move(next);
        cached_at_ = now;
    }
}

std::vector<YieldPool> LlamaClient::scan(const YieldQuery& q) {
    ensure_cached_();

    // Snapshot the cache under the lock, then filter outside the critical
    // section so concurrent scans don't block each other.
    std::vector<YieldPool> snap;
    {
        std::lock_guard<std::mutex> lk(mtx_);
        snap = cached_;
    }

    // Normalize the wanted-symbols set to upper-case for comparison.
    std::set<std::string> wanted_upper;
    for (auto s : q.symbols) wanted_upper.insert(upper(std::move(s)));

    std::vector<YieldPool> out;
    out.reserve(std::min<std::size_t>(snap.size(), q.max_results * 2));

    for (const auto& p : snap) {
        if (!q.chain_keys.empty() && !q.chain_keys.count(p.chain_key)) continue;
        if (p.tvl_usd < q.min_tvl_usd) continue;
        if (p.apy   < q.min_apy_pct)  continue;
        if (q.stable_only && !p.stablecoin) continue;
        if (q.single_exposure_only && p.exposure != "single") continue;
        if (q.no_il_only && p.il_risk == "yes") continue;
        if (!symbol_matches(p.symbol, wanted_upper)) continue;
        out.push_back(p);
    }

    // Sort by APY desc.
    std::sort(out.begin(), out.end(),
              [](const YieldPool& a, const YieldPool& b) { return a.apy > b.apy; });

    if (q.max_results > 0 && static_cast<int>(out.size()) > q.max_results) {
        out.resize(q.max_results);
    }
    return out;
}

}  // namespace cryptoapp::yield

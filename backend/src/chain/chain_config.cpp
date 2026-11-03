#include "cryptoapp/chain/chain_config.hpp"

#include <fstream>
#include <stdexcept>

#include <nlohmann/json.hpp>

namespace cryptoapp::chain {

namespace {
nlohmann::json read_json_file(const std::filesystem::path& p) {
    std::ifstream f(p);
    if (!f) throw std::runtime_error("Cannot open " + p.string());
    nlohmann::json j;
    f >> j;
    return j;
}
}  // namespace

Registry Registry::load(const std::filesystem::path& chains_json,
                        const std::optional<std::filesystem::path>& tokens_json) {
    Registry r;

    auto j = read_json_file(chains_json);
    if (!j.contains("chains") || !j["chains"].is_array()) {
        throw std::runtime_error("chains.json: missing 'chains' array");
    }

    for (const auto& c : j["chains"]) {
        ChainConfig cfg;
        cfg.key = c.value("key", "");
        cfg.name = c.value("name", cfg.key);
        cfg.chain_id = c.value("chain_id", 0ULL);
        cfg.native_symbol = c.value("native_symbol", "ETH");
        cfg.native_decimals = c.value("native_decimals", 18);
        cfg.native_coingecko_id = c.value("native_coingecko_id", "");
        cfg.explorer = c.value("explorer", "");

        if (c.contains("rpc_urls") && c["rpc_urls"].is_array()) {
            for (const auto& u : c["rpc_urls"]) cfg.rpc_urls.push_back(u.get<std::string>());
        }
        if (cfg.rpc_urls.empty()) {
            throw std::runtime_error("chain " + cfg.key + ": no rpc_urls");
        }
        cfg.multicall3 = Address::from_hex(c.value("multicall3", "0xcA11bde05977b3631167028862bE2a173976CA11"));

        // Optional DeFi addresses — leave as zero-address if not configured.
        const std::string ZERO = "0x0000000000000000000000000000000000000000";
        cfg.aave_v3_pool = Address::from_hex(c.value("aave_v3_pool", ZERO));
        cfg.spark_pool   = Address::from_hex(c.value("spark_pool",   ZERO));
        cfg.uniswap_v3_position_manager =
            Address::from_hex(c.value("uniswap_v3_position_manager", ZERO));
        cfg.uniswap_v3_factory =
            Address::from_hex(c.value("uniswap_v3_factory", ZERO));

        if (c.contains("compound_v3_markets") && c["compound_v3_markets"].is_array()) {
            for (const auto& m : c["compound_v3_markets"]) {
                CompoundV3Market mk;
                mk.base_symbol  = m.value("base_symbol", "");
                mk.base_address = Address::from_hex(m.value("base_address", ZERO));
                mk.base_decimals = m.value("base_decimals", 18);
                mk.comet        = Address::from_hex(m.value("comet", ZERO));
                if (!mk.comet.is_zero()) cfg.compound_v3_markets.push_back(std::move(mk));
            }
        }
        cfg.native_usd_estimate = c.value("native_usd_estimate", 0.0);

        r.by_key_[cfg.key] = r.chains_.size();
        r.chains_.push_back(std::move(cfg));
    }

    if (tokens_json) {
        auto tj = read_json_file(*tokens_json);
        if (tj.contains("tokens") && tj["tokens"].is_object()) {
            for (auto it = tj["tokens"].begin(); it != tj["tokens"].end(); ++it) {
                const std::string& key = it.key();
                auto fit = r.by_key_.find(key);
                if (fit == r.by_key_.end()) continue;  // skip unknown chain
                auto& chain = r.chains_[fit->second];
                for (const auto& t : it.value()) {
                    TokenInfo ti;
                    ti.symbol = t.value("symbol", "");
                    ti.address = Address::from_hex(t.value("address", "0x0000000000000000000000000000000000000000"));
                    ti.decimals = t.value("decimals", 18);
                    ti.coingecko_id = t.value("coingecko_id", "");
                    chain.tokens.push_back(std::move(ti));
                }
            }
        }
    }

    return r;
}

const ChainConfig* Registry::find(std::string_view key) const {
    auto it = by_key_.find(std::string(key));
    if (it == by_key_.end()) return nullptr;
    return &chains_[it->second];
}

}  // namespace cryptoapp::chain

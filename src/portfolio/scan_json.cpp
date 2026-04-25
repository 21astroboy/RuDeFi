#include "cryptoapp/portfolio/scan_json.hpp"

namespace cryptoapp::portfolio {

nlohmann::json scan_result_to_json(const ScanResult& res) {
    nlohmann::json j;
    j["total_usd"] = res.total_usd;
    j["total_rub"] = res.total_rub;
    j["usd_rub_rate"] = res.usd_rub_rate;
    j["warnings"] = res.warnings;

    nlohmann::json holdings = nlohmann::json::array();
    for (const auto& h : res.holdings) {
        // Pre-compute a human-readable amount using your format_units helper.
        std::string amt = chain::format_units(h.raw_balance, h.decimals, 8);
        holdings.push_back({
            {"chain_key", h.chain_key},
            {"chain_name", h.chain_name},
            {"symbol", h.symbol},
            {"is_native", h.is_native},
            {"token_address", h.token_addr.hex()},
            {"decimals", h.decimals},
            {"amount", amt},
            {"price_usd", h.price_usd},
            {"value_usd", h.value_usd},
            {"value_rub", h.value_rub},
        });
    }
    j["holdings"] = std::move(holdings);

    // DeFi positions (Aave V3, Uniswap V3, ...).
    nlohmann::json defi = nlohmann::json::array();
    for (const auto& p : res.defi_positions) {
        // Pre-format raw amounts so the UI doesn't have to do U256 math.
        std::string amt0 = p.amount0_raw == 0 ? std::string{}
                          : chain::format_units(p.amount0_raw, p.decimals0, 6);
        std::string amt1 = p.amount1_raw == 0 ? std::string{}
                          : chain::format_units(p.amount1_raw, p.decimals1, 6);
        defi.push_back({
            {"chain_key", p.chain_key},
            {"chain_name", p.chain_name},
            {"protocol", p.protocol},
            {"kind", p.kind},
            {"label", p.label},
            {"link", p.link},
            {"token0_symbol", p.token0_symbol},
            {"token1_symbol", p.token1_symbol},
            {"token0_address", p.token0_address.hex()},
            {"token1_address", p.token1_address.hex()},
            {"amount0", amt0},
            {"amount1", amt1},
            {"value_usd", p.value_usd},
            {"value_rub", p.value_rub},
            {"health_factor", p.health_factor},
            {"in_range", p.in_range},
        });
    }
    j["defi_positions"] = std::move(defi);
    return j;
}

}  // namespace cryptoapp::portfolio

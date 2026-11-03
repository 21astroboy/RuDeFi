// defi_types.hpp - Common DeFi position type for protocol scanners.
#pragma once

#include "cryptoapp/chain/eth_types.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace cryptoapp::defi {

// One row in the "DeFi positions" section. Different protocols populate
// different fields; the UI degrades gracefully when something is empty.
struct DefiPosition {
    std::string chain_key;
    std::string chain_name;
    std::string protocol;       // "Aave V3", "Uniswap V3", "Compound V3", ...
    std::string kind;           // "supply", "borrow", "lp", "summary"
    std::string label;          // "USDC supplied", "ETH/USDC 0.05% LP", "Health: 2.41"
    std::string link;           // optional explorer / app deep-link

    // Optional concrete amounts. Either pair-amounts (for LPs) or single (for supplies).
    std::string token0_symbol;
    std::string token1_symbol;
    chain::Address token0_address;
    chain::Address token1_address;
    chain::U256 amount0_raw{0};
    chain::U256 amount1_raw{0};
    std::uint8_t decimals0 = 18;
    std::uint8_t decimals1 = 18;
    // Pricing identifiers — set by the scanner so the price service can fill
    // value_usd in a later step. Empty when the token is unknown to us.
    std::string token0_coingecko_id;
    std::string token1_coingecko_id;

    // Pre-computed values (in USD, RUB) when the protocol gave us prices directly.
    // 0 means "not applicable" — UI falls back to "—".
    double value_usd = 0;
    double value_rub = 0;

    // Protocol-specific small flags / numbers worth showing.
    double health_factor = 0;   // Aave: collateral / debt risk metric (1.0 = liquidation).
    double apy = 0;             // future: when we know the borrow/supply rate.
    bool   in_range = true;     // Uniswap V3: position currently earning fees.
};

}  // namespace cryptoapp::defi

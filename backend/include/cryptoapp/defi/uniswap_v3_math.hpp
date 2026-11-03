// uniswap_v3_math.hpp - Port of Uniswap V3 TickMath + SqrtPriceMath.
//
// We need this to convert (liquidity, tickLower, tickUpper, current sqrtPrice)
// into the actual token amounts a position holds. Reference:
//   https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/TickMath.sol
//   https://github.com/Uniswap/v3-core/blob/main/contracts/libraries/SqrtPriceMath.sol
//
// Design notes:
//   * All intermediate math is in U256 (uint256_t). Multiplications that
//     would overflow are routed through cpp_int and shifted back down.
//   * Constants below are bit-for-bit equivalent to the Solidity originals.
#pragma once

#include "cryptoapp/chain/eth_types.hpp"

#include <cstdint>

namespace cryptoapp::defi::univ3 {

constexpr std::int32_t MIN_TICK = -887272;
constexpr std::int32_t MAX_TICK =  887272;

// sqrtPriceX96 = sqrt(price) * 2^96, where price = token1/token0 in raw units.
[[nodiscard]] chain::U256 get_sqrt_ratio_at_tick(std::int32_t tick);

// Amount of token0 you'd need (or get back) to provide `liquidity` between two
// sqrt-prices. Implementation matches Uniswap's `getAmount0Delta(roundUp=false)`.
[[nodiscard]] chain::U256 get_amount0_delta(chain::U256 sqrt_a,
                                            chain::U256 sqrt_b,
                                            chain::U256 liquidity);

// Same for token1. Matches `getAmount1Delta(roundUp=false)`.
[[nodiscard]] chain::U256 get_amount1_delta(chain::U256 sqrt_a,
                                            chain::U256 sqrt_b,
                                            chain::U256 liquidity);

struct PositionAmounts {
    chain::U256 amount0;
    chain::U256 amount1;
};

// Pure formula — given a position's range and the pool's *current* sqrtPrice,
// compute how much token0 and token1 are inside that position right now.
// `tick_current` is needed because the formula picks a different branch
// when current tick is below/inside/above the position's tick range.
[[nodiscard]] PositionAmounts compute_position_amounts(
    chain::U256 sqrt_price_current,
    std::int32_t tick_current,
    std::int32_t tick_lower,
    std::int32_t tick_upper,
    chain::U256 liquidity);

}  // namespace cryptoapp::defi::univ3

#include "cryptoapp/defi/uniswap_v3_math.hpp"

#include <boost/multiprecision/cpp_int.hpp>

#include <stdexcept>

namespace cryptoapp::defi::univ3 {

namespace {

namespace bm = boost::multiprecision;
using U256 = chain::U256;

// uint256.max
const U256 U256_MAX = (U256{1} << 256) - 1;

// MulShift128: returns (x * y) >> 128 with full 512-bit precision.
inline U256 mulshift_128(const U256& x, const U256& y) {
    bm::cpp_int prod = bm::cpp_int(x) * bm::cpp_int(y);
    bm::cpp_int shifted = prod >> 128;
    return static_cast<U256>(shifted);
}

// MulDiv: returns (a * b) / denom with full precision.
inline U256 muldiv(const U256& a, const U256& b, const U256& denom) {
    bm::cpp_int prod = bm::cpp_int(a) * bm::cpp_int(b);
    bm::cpp_int q = prod / bm::cpp_int(denom);
    return static_cast<U256>(q);
}

// Construct U256 from a hex literal (no '0x' prefix).
U256 hx(const char* h) { return U256{std::string("0x") + h}; }

}  // namespace

U256 get_sqrt_ratio_at_tick(std::int32_t tick) {
    const std::uint32_t abs_tick = tick < 0 ? static_cast<std::uint32_t>(-tick)
                                            : static_cast<std::uint32_t>(tick);
    if (abs_tick > static_cast<std::uint32_t>(MAX_TICK)) {
        throw std::out_of_range("uniswap_v3: tick out of range");
    }

    // Magic numbers from Uniswap V3 TickMath. Each represents the multiplier
    // for the corresponding bit of |tick|; the result accumulates as a Q128.128
    // fixed-point number, then we shift back down to Q64.96 at the end.
    U256 ratio = (abs_tick & 0x1) != 0
        ? hx("fffcb933bd6fad37aa2d162d1a594001")
        : hx("100000000000000000000000000000000");
    if (abs_tick & 0x2)     ratio = mulshift_128(ratio, hx("fff97272373d413259a46990580e213a"));
    if (abs_tick & 0x4)     ratio = mulshift_128(ratio, hx("fff2e50f5f656932ef12357cf3c7fdcc"));
    if (abs_tick & 0x8)     ratio = mulshift_128(ratio, hx("ffe5caca7e10e4e61c3624eaa0941cd0"));
    if (abs_tick & 0x10)    ratio = mulshift_128(ratio, hx("ffcb9843d60f6159c9db58835c926644"));
    if (abs_tick & 0x20)    ratio = mulshift_128(ratio, hx("ff973b41fa98c081472e6896dfb254c0"));
    if (abs_tick & 0x40)    ratio = mulshift_128(ratio, hx("ff2ea16466c96a3843ec78b326b52861"));
    if (abs_tick & 0x80)    ratio = mulshift_128(ratio, hx("fe5dee046a99a2a811c461f1969c3053"));
    if (abs_tick & 0x100)   ratio = mulshift_128(ratio, hx("fcbe86c7900a88aedcffc83b479aa3a4"));
    if (abs_tick & 0x200)   ratio = mulshift_128(ratio, hx("f987a7253ac413176f2b074cf7815e54"));
    if (abs_tick & 0x400)   ratio = mulshift_128(ratio, hx("f3392b0822b70005940c7a398e4b70f3"));
    if (abs_tick & 0x800)   ratio = mulshift_128(ratio, hx("e7159475a2c29b7443b29c7fa6e889d9"));
    if (abs_tick & 0x1000)  ratio = mulshift_128(ratio, hx("d097f3bdfd2022b8845ad8f792aa5825"));
    if (abs_tick & 0x2000)  ratio = mulshift_128(ratio, hx("a9f746462d870fdf8a65dc1f90e061e5"));
    if (abs_tick & 0x4000)  ratio = mulshift_128(ratio, hx("70d869a156d2a1b890bb3df62baf32f7"));
    if (abs_tick & 0x8000)  ratio = mulshift_128(ratio, hx("31be135f97d08fd981231505542fcfa6"));
    if (abs_tick & 0x10000) ratio = mulshift_128(ratio, hx("9aa508b5b7a84e1c677de54f3e99bc9"));
    if (abs_tick & 0x20000) ratio = mulshift_128(ratio, hx("5d6af8dedb81196699c329225ee604"));
    if (abs_tick & 0x40000) ratio = mulshift_128(ratio, hx("2216e584f5fa1ea926041bedfe98"));
    if (abs_tick & 0x80000) ratio = mulshift_128(ratio, hx("48a170391f7dc42444e8fa2"));

    if (tick > 0) ratio = U256_MAX / ratio;

    // Convert from Q128.128 to Q64.96 (sqrtPriceX96), rounding up if any low bits set.
    const U256 mod = ratio & U256{0xFFFFFFFFu};
    U256 sqrt_price = ratio >> 32;
    if (mod != 0) sqrt_price += 1;
    return sqrt_price;
}

// Liquidity is uint128, sqrt-prices are uint160 (each fits in U256 comfortably).
// Standard formulas, rounded down (we display, not transact, so round-down is
// fine and slightly conservative).
U256 get_amount0_delta(U256 sqrt_a, U256 sqrt_b, U256 liquidity) {
    if (sqrt_a > sqrt_b) std::swap(sqrt_a, sqrt_b);
    if (sqrt_a == 0) return 0;
    // amount0 = L * (sqrtB - sqrtA) << 96 / (sqrtA * sqrtB)
    const U256 numerator1 = liquidity << 96;
    const U256 numerator2 = sqrt_b - sqrt_a;
    // We compute: muldiv(numerator1, numerator2, sqrtB) / sqrtA
    const bm::cpp_int prod = bm::cpp_int(numerator1) * bm::cpp_int(numerator2);
    const bm::cpp_int step1 = prod / bm::cpp_int(sqrt_b);
    const bm::cpp_int step2 = step1 / bm::cpp_int(sqrt_a);
    return static_cast<U256>(step2);
}

U256 get_amount1_delta(U256 sqrt_a, U256 sqrt_b, U256 liquidity) {
    if (sqrt_a > sqrt_b) std::swap(sqrt_a, sqrt_b);
    // amount1 = L * (sqrtB - sqrtA) >> 96
    const U256 diff = sqrt_b - sqrt_a;
    const bm::cpp_int prod = bm::cpp_int(liquidity) * bm::cpp_int(diff);
    const bm::cpp_int q = prod >> 96;
    return static_cast<U256>(q);
}

PositionAmounts compute_position_amounts(U256 sqrt_price_current,
                                         std::int32_t tick_current,
                                         std::int32_t tick_lower,
                                         std::int32_t tick_upper,
                                         U256 liquidity) {
    PositionAmounts r{0, 0};
    if (liquidity == 0) return r;
    const U256 sqrt_lower = get_sqrt_ratio_at_tick(tick_lower);
    const U256 sqrt_upper = get_sqrt_ratio_at_tick(tick_upper);

    if (tick_current < tick_lower) {
        // Entirely token0.
        r.amount0 = get_amount0_delta(sqrt_lower, sqrt_upper, liquidity);
    } else if (tick_current < tick_upper) {
        // Mixed (in range).
        r.amount0 = get_amount0_delta(sqrt_price_current, sqrt_upper, liquidity);
        r.amount1 = get_amount1_delta(sqrt_lower, sqrt_price_current, liquidity);
    } else {
        // Entirely token1.
        r.amount1 = get_amount1_delta(sqrt_lower, sqrt_upper, liquidity);
    }
    return r;
}

}  // namespace cryptoapp::defi::univ3

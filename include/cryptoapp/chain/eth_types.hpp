// eth_types.hpp - Address, U256, helpers.
#pragma once

#include <array>
#include <cstdint>
#include <string>
#include <string_view>

#include <boost/multiprecision/cpp_int.hpp>

namespace cryptoapp::chain {

using U256 = boost::multiprecision::uint256_t;

class Address {
public:
    Address() = default;

    // Parse from "0x..." or raw 40-char hex. Throws on bad input.
    static Address from_hex(std::string_view s);

    [[nodiscard]] std::string hex() const;             // "0x" + 40 lowercase chars
    [[nodiscard]] const std::array<std::uint8_t, 20>& bytes() const noexcept { return bytes_; }
    [[nodiscard]] bool is_zero() const noexcept;

    bool operator==(const Address& o) const noexcept = default;

private:
    std::array<std::uint8_t, 20> bytes_{};
};

// Pretty-print U256 as a decimal string scaled by 10^decimals (e.g. wei -> ether).
// Truncates excess fractional digits beyond `display_precision`.
[[nodiscard]] std::string format_units(const U256& raw,
                                       std::uint8_t decimals,
                                       std::uint8_t display_precision = 6);

// Parse a 0x-hex string into U256 (any width up to 256 bits).
[[nodiscard]] U256 parse_hex_u256(std::string_view s);

// Format U256 as 0x... (without padding to 64 chars).
[[nodiscard]] std::string to_hex(const U256& v);

// Convert U256 -> double; will lose precision for large values, used only for fiat math.
[[nodiscard]] double to_double_units(const U256& raw, std::uint8_t decimals);

}  // namespace cryptoapp::chain

// hex.hpp - Hex encoding/decoding helpers for ABI work.
#pragma once

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace cryptoapp::util {

// Strip optional "0x" prefix and lowercase the rest.
[[nodiscard]] std::string normalize_hex(std::string_view s);

// Decode hex (with or without 0x) into raw bytes. Throws std::invalid_argument on bad input.
[[nodiscard]] std::vector<std::uint8_t> hex_decode(std::string_view s);

// Encode bytes as lowercase hex with "0x" prefix.
[[nodiscard]] std::string hex_encode(const std::vector<std::uint8_t>& bytes);
[[nodiscard]] std::string hex_encode(const std::uint8_t* data, std::size_t len);

// Pad-left a hex string (no 0x prefix) to `width` chars with '0'.
[[nodiscard]] std::string pad_left_hex(std::string_view s, std::size_t width = 64);

// Convert a 0x-hex address (40 chars) to ABI-encoded 32-byte word (0x + 64 chars, no prefix added).
[[nodiscard]] std::string address_to_abi_word(std::string_view addr);

// Parse a hex-encoded uint (e.g. "0x1abc") into uint64_t. Throws on overflow / bad input.
[[nodiscard]] std::uint64_t parse_hex_uint64(std::string_view s);

}  // namespace cryptoapp::util

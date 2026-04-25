#include "cryptoapp/util/hex.hpp"

#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace cryptoapp::util {

namespace {
inline int hex_val(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
    if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
    return -1;
}
}  // namespace

std::string normalize_hex(std::string_view s) {
    if (s.size() >= 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) {
        s.remove_prefix(2);
    }
    std::string out;
    out.reserve(s.size());
    for (char c : s) out.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    return out;
}

std::vector<std::uint8_t> hex_decode(std::string_view s) {
    auto h = normalize_hex(s);
    if (h.size() % 2 != 0) {
        throw std::invalid_argument("hex_decode: odd length");
    }
    std::vector<std::uint8_t> out;
    out.reserve(h.size() / 2);
    for (std::size_t i = 0; i < h.size(); i += 2) {
        int hi = hex_val(h[i]);
        int lo = hex_val(h[i + 1]);
        if (hi < 0 || lo < 0) throw std::invalid_argument("hex_decode: bad char");
        out.push_back(static_cast<std::uint8_t>((hi << 4) | lo));
    }
    return out;
}

std::string hex_encode(const std::uint8_t* data, std::size_t len) {
    static constexpr char digits[] = "0123456789abcdef";
    std::string out;
    out.reserve(2 + len * 2);
    out.append("0x");
    for (std::size_t i = 0; i < len; ++i) {
        out.push_back(digits[(data[i] >> 4) & 0xF]);
        out.push_back(digits[data[i] & 0xF]);
    }
    return out;
}

std::string hex_encode(const std::vector<std::uint8_t>& bytes) {
    return hex_encode(bytes.data(), bytes.size());
}

std::string pad_left_hex(std::string_view s, std::size_t width) {
    auto h = normalize_hex(s);
    if (h.size() >= width) return h;
    std::string out(width - h.size(), '0');
    out.append(h);
    return out;
}

std::string address_to_abi_word(std::string_view addr) {
    auto h = normalize_hex(addr);
    if (h.size() != 40) {
        throw std::invalid_argument("address_to_abi_word: expected 20-byte address");
    }
    return pad_left_hex(h, 64);
}

std::uint64_t parse_hex_uint64(std::string_view s) {
    auto h = normalize_hex(s);
    if (h.empty()) throw std::invalid_argument("parse_hex_uint64: empty");
    if (h.size() > 16) throw std::invalid_argument("parse_hex_uint64: too large for uint64");
    std::uint64_t v = 0;
    for (char c : h) {
        int d = hex_val(c);
        if (d < 0) throw std::invalid_argument("parse_hex_uint64: bad char");
        v = (v << 4) | static_cast<std::uint64_t>(d);
    }
    return v;
}

}  // namespace cryptoapp::util

#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/util/hex.hpp"

#include <algorithm>
#include <cmath>
#include <sstream>
#include <stdexcept>

namespace cryptoapp::chain {

Address Address::from_hex(std::string_view s) {
    auto bytes = util::hex_decode(s);
    if (bytes.size() != 20) {
        throw std::invalid_argument("Address: expected 20 bytes");
    }
    Address a;
    std::copy(bytes.begin(), bytes.end(), a.bytes_.begin());
    return a;
}

std::string Address::hex() const {
    return util::hex_encode(bytes_.data(), bytes_.size());
}

bool Address::is_zero() const noexcept {
    for (auto b : bytes_) if (b != 0) return false;
    return true;
}

U256 parse_hex_u256(std::string_view s) {
    auto h = util::normalize_hex(s);
    if (h.empty()) return U256{0};
    // boost::multiprecision can parse "0x..."
    return U256{"0x" + h};
}

std::string to_hex(const U256& v) {
    if (v == 0) return "0x0";
    std::ostringstream os;
    os << std::hex << v;
    return "0x" + os.str();
}

std::string format_units(const U256& raw, std::uint8_t decimals, std::uint8_t display_precision) {
    if (decimals == 0) {
        std::ostringstream os; os << raw; return os.str();
    }
    // Build base = 10^decimals
    U256 base = 1;
    for (std::uint8_t i = 0; i < decimals; ++i) base *= 10;

    U256 whole = raw / base;
    U256 frac = raw % base;

    std::ostringstream os;
    os << whole;
    if (display_precision == 0 || frac == 0) {
        return os.str();
    }

    // Pad frac to `decimals` digits, then truncate to display_precision.
    std::ostringstream frac_os;
    frac_os << frac;
    std::string frac_str = frac_os.str();
    if (frac_str.size() < decimals) {
        frac_str.insert(frac_str.begin(), decimals - frac_str.size(), '0');
    }
    if (frac_str.size() > display_precision) {
        frac_str.resize(display_precision);
    }
    // Trim trailing zeroes for cleaner output.
    while (!frac_str.empty() && frac_str.back() == '0') frac_str.pop_back();
    if (frac_str.empty()) return os.str();
    os << '.' << frac_str;
    return os.str();
}

double to_double_units(const U256& raw, std::uint8_t decimals) {
    // Avoid overflow: divide first, then add fractional part.
    if (decimals == 0) {
        return raw.convert_to<double>();
    }
    U256 base = 1;
    for (std::uint8_t i = 0; i < decimals; ++i) base *= 10;
    U256 whole = raw / base;
    U256 frac = raw % base;
    double w = whole.convert_to<double>();
    double f = frac.convert_to<double>() / std::pow(10.0, decimals);
    return w + f;
}

}  // namespace cryptoapp::chain

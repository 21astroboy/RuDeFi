// scan_json.hpp - Serialize a ScanResult to a UI-friendly JSON shape.
#pragma once

#include "cryptoapp/portfolio/portfolio_scanner.hpp"

#include <nlohmann/json.hpp>

namespace cryptoapp::portfolio {

[[nodiscard]] nlohmann::json scan_result_to_json(const ScanResult& res);

}  // namespace cryptoapp::portfolio

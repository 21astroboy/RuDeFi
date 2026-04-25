// portfolio_scanner.hpp - Multi-chain native + ERC-20 balance scan.
#pragma once

#include "cryptoapp/chain/chain_config.hpp"
#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/defi/defi_types.hpp"
#include "cryptoapp/pricing/fx_service.hpp"
#include "cryptoapp/pricing/price_service.hpp"
#include "cryptoapp/util/http.hpp"

#include <memory>
#include <string>
#include <vector>

namespace cryptoapp::portfolio {

struct Holding {
    std::string chain_key;
    std::string chain_name;
    std::string symbol;
    chain::Address token_addr;     // zero for native
    bool is_native = false;
    chain::U256 raw_balance;       // smallest unit
    std::uint8_t decimals = 18;
    std::string coingecko_id;
    // filled in after pricing
    double price_usd = 0;          // 0 if unknown
    double value_usd = 0;
    double value_rub = 0;
};

struct ScanResult {
    std::vector<Holding> holdings;
    std::vector<defi::DefiPosition> defi_positions;
    double total_usd = 0;          // wallet holdings + Aave net (collateral - debt)
    double total_rub = 0;
    double usd_rub_rate = 0;       // 0 if unknown
    std::vector<std::string> warnings;
};

struct ScanOptions {
    bool include_zero = false;     // skip dust/zero balances by default
    int concurrency = 11;          // parallel chain scans (one per chain to avoid serialization)
    bool fetch_prices = true;
    bool scan_defi = true;         // scan Aave V3 + Uniswap V3 positions
};

class PortfolioScanner {
public:
    PortfolioScanner(const chain::Registry& registry,
                     std::shared_ptr<util::HttpClient> http,
                     std::shared_ptr<pricing::PriceService> prices,
                     std::shared_ptr<pricing::FxService> fx);

    [[nodiscard]] ScanResult scan(const chain::Address& wallet,
                                  const ScanOptions& opts = {});

private:
    const chain::Registry& registry_;
    std::shared_ptr<util::HttpClient> http_;
    std::shared_ptr<pricing::PriceService> prices_;
    std::shared_ptr<pricing::FxService> fx_;
};

}  // namespace cryptoapp::portfolio

// approvals.hpp - Scan ERC-20 approvals against a list of well-known spenders.
//
// We don't crawl Approval logs (would need eth_getLogs across many blocks).
// Instead we check `allowance(owner, spender)` for each (token, spender) pair
// across the registry — covers ~95% of the real-world risk: routers, pools,
// bridges. Quick, and fits in a single multicall per chain.
#pragma once

#include "cryptoapp/chain/chain_config.hpp"
#include "cryptoapp/util/http.hpp"

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

namespace cryptoapp::security {

struct Approval {
    std::string chain_key;
    std::string chain_name;
    std::string token_symbol;
    chain::Address token_address;
    std::uint8_t token_decimals = 18;
    std::string spender_label;       // "Uniswap Universal Router" etc.
    chain::Address spender_address;
    chain::U256 allowance_raw;       // raw uint256
    std::string allowance_human;     // pre-formatted; "unlimited" if MAX
    bool unlimited = false;          // allowance == 2^256-1 (or close)
};

struct ApprovalScanOptions {
    int concurrency = 4;
};

class ApprovalScanner {
public:
    ApprovalScanner(const chain::Registry& registry,
                    std::shared_ptr<util::HttpClient> http);

    [[nodiscard]] std::vector<Approval>
    scan(const chain::Address& wallet, const ApprovalScanOptions& opts = {});

private:
    const chain::Registry& registry_;
    std::shared_ptr<util::HttpClient> http_;
};

}  // namespace cryptoapp::security

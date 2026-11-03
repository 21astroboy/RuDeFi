// goplus_client.hpp - Token security check via GoPlus Labs.
//
// GoPlus is a free public API (https://gopluslabs.io) that aggregates
// dozens of "is this token a scam?" signals: contract verification, owner
// powers, transfer restrictions, sell tax, blacklist functions, honeypot
// detection. We use it before a swap or deposit to warn the user.
#pragma once

#include "cryptoapp/util/http.hpp"

#include <chrono>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>

namespace cryptoapp::security {

struct TokenSecurity {
    std::string chain_key;            // mapped to our chain_key
    std::string token_address;
    std::string token_name;
    std::string token_symbol;

    // High-level verdict: "ok" | "warn" | "bad" | "unknown".
    std::string verdict;
    std::string verdict_reason;       // short human summary

    // Raw signals (filled when GoPlus returns them).
    bool is_open_source = false;
    bool is_proxy = false;
    bool is_honeypot = false;
    bool transfer_pausable = false;
    bool can_take_back_ownership = false;
    bool owner_change_balance = false;
    bool hidden_owner = false;
    bool selfdestruct = false;
    bool is_blacklisted = false;
    bool is_whitelisted = false;
    bool slippage_modifiable = false;
    bool personal_slippage_modifiable = false;
    bool external_call = false;

    double buy_tax = 0;               // 0.0–1.0 (5% = 0.05)
    double sell_tax = 0;
    int    holders = 0;
    int    lp_holders = 0;

    std::string raw_error;            // populated on transport failure
};

class GoplusClient {
public:
    explicit GoplusClient(std::shared_ptr<util::HttpClient> http,
                          std::chrono::minutes ttl = std::chrono::minutes(60));

    // Look up a token. Returns cached result if fresh; otherwise calls GoPlus.
    [[nodiscard]] TokenSecurity check(const std::string& chain_key,
                                      std::uint64_t chain_id,
                                      const std::string& token_address);

private:
    std::shared_ptr<util::HttpClient> http_;
    std::chrono::minutes ttl_;
    struct CacheEntry { TokenSecurity result; std::chrono::steady_clock::time_point at; };
    std::unordered_map<std::string, CacheEntry> cache_;  // key = chain_id|addr
    std::mutex mtx_;
};

}  // namespace cryptoapp::security

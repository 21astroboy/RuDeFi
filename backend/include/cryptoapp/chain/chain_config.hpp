// chain_config.hpp - Chain & token registries loaded from JSON.
#pragma once

#include "cryptoapp/chain/eth_types.hpp"

#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace cryptoapp::chain {

struct TokenInfo {
    std::string symbol;
    Address address;
    std::uint8_t decimals = 18;
    std::string coingecko_id;
};

// Compound V3 deploys one Comet contract per market (base asset). User's
// supplied base balance = Comet.balanceOf(account) (auto-includes interest).
struct CompoundV3Market {
    std::string base_symbol;
    Address base_address;       // ERC-20 you can supply / withdraw
    std::uint8_t base_decimals = 18;
    Address comet;              // the Comet contract
};

struct ChainConfig {
    std::string key;                 // "ethereum", "arbitrum", ...
    std::string name;
    std::uint64_t chain_id = 0;
    std::string native_symbol;       // "ETH", "MATIC", ...
    std::uint8_t native_decimals = 18;
    std::string native_coingecko_id;
    std::vector<std::string> rpc_urls;
    Address multicall3;
    std::string explorer;
    std::vector<TokenInfo> tokens;

    // Optional DeFi protocol addresses (zero if absent on this chain).
    Address aave_v3_pool;
    Address spark_pool;                 // Aave V3 fork; same ABI, different pool
    Address uniswap_v3_position_manager;
    Address uniswap_v3_factory;
    std::vector<CompoundV3Market> compound_v3_markets;

    double native_usd_estimate = 0;        // for gas cost estimation when no live price
};

class Registry {
public:
    // Load chain registry from chains.json. Tokens optional (tokens.json).
    static Registry load(const std::filesystem::path& chains_json,
                         const std::optional<std::filesystem::path>& tokens_json = std::nullopt);

    [[nodiscard]] const std::vector<ChainConfig>& chains() const noexcept { return chains_; }
    [[nodiscard]] const ChainConfig* find(std::string_view key) const;

private:
    std::vector<ChainConfig> chains_;
    std::unordered_map<std::string, std::size_t> by_key_;
};

}  // namespace cryptoapp::chain

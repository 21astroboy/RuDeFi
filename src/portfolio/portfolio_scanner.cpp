#include "cryptoapp/portfolio/portfolio_scanner.hpp"

#include "cryptoapp/chain/multicall.hpp"
#include "cryptoapp/chain/rpc_client.hpp"
#include "cryptoapp/defi/aave_v3.hpp"
#include "cryptoapp/defi/compound_v3.hpp"
#include "cryptoapp/defi/uniswap_v3.hpp"

#include <algorithm>
#include <future>
#include <mutex>
#include <set>

namespace cryptoapp::portfolio {

namespace {

// Per-chain scan result: holdings + DeFi positions + any warnings.
struct ChainScanResult {
    std::vector<Holding> holdings;
    std::vector<defi::DefiPosition> defi_positions;
    std::vector<std::string> warnings;
};

ChainScanResult scan_chain(const chain::ChainConfig& cfg,
                           const chain::Address& wallet,
                           std::shared_ptr<util::HttpClient> http,
                           bool scan_defi) {
    ChainScanResult out;
    chain::RpcClient rpc(cfg.rpc_urls, http);

    // 1. Native balance.
    try {
        auto bal = rpc.eth_get_balance(wallet);
        Holding h;
        h.chain_key = cfg.key;
        h.chain_name = cfg.name;
        h.symbol = cfg.native_symbol;
        h.is_native = true;
        h.decimals = cfg.native_decimals;
        h.coingecko_id = cfg.native_coingecko_id;
        h.raw_balance = bal;
        out.holdings.push_back(std::move(h));
    } catch (const std::exception& e) {
        out.warnings.push_back("[" + cfg.key + "] native balance failed: " + e.what());
    }

    // 2. ERC-20 balances via Multicall3 (one round-trip).
    if (!cfg.tokens.empty()) {
        std::vector<chain::Call3> calls;
        calls.reserve(cfg.tokens.size());
        const auto bal_data = chain::encode_erc20_balance_of(wallet);
        for (const auto& t : cfg.tokens) {
            chain::Call3 c;
            c.target = t.address;
            c.allow_failure = true;  // a wrong-address token shouldn't kill the batch
            c.call_data_hex = bal_data;
            calls.push_back(std::move(c));
        }
        try {
            auto results = chain::aggregate3(rpc, cfg.multicall3, calls);
            for (std::size_t i = 0; i < results.size() && i < cfg.tokens.size(); ++i) {
                const auto& t = cfg.tokens[i];
                if (!results[i].success) continue;
                // balanceOf returns a single uint256 word.
                chain::U256 bal = chain::parse_hex_u256(results[i].return_data_hex);
                Holding h;
                h.chain_key = cfg.key;
                h.chain_name = cfg.name;
                h.symbol = t.symbol;
                h.token_addr = t.address;
                h.decimals = t.decimals;
                h.coingecko_id = t.coingecko_id;
                h.raw_balance = bal;
                out.holdings.push_back(std::move(h));
            }
        } catch (const std::exception& e) {
            out.warnings.push_back("[" + cfg.key + "] multicall failed: " + e.what());
        }
    }

    // 3. DeFi protocols (best-effort — failure here just adds a warning).
    if (scan_defi) {
        try {
            auto aave = defi::scan_aave_v3(rpc, cfg, wallet);
            out.defi_positions.insert(out.defi_positions.end(),
                                      std::make_move_iterator(aave.begin()),
                                      std::make_move_iterator(aave.end()));
        } catch (const std::exception& e) {
            out.warnings.push_back(std::string("[") + cfg.key + "] aave: " + e.what());
        }
        if (!cfg.spark_pool.is_zero()) {
            try {
                auto spark = defi::scan_aave_like(rpc, cfg, wallet, cfg.spark_pool, "Spark");
                out.defi_positions.insert(out.defi_positions.end(),
                                          std::make_move_iterator(spark.begin()),
                                          std::make_move_iterator(spark.end()));
            } catch (const std::exception& e) {
                out.warnings.push_back(std::string("[") + cfg.key + "] spark: " + e.what());
            }
        }
        try {
            auto comp = defi::scan_compound_v3(rpc, cfg, wallet);
            out.defi_positions.insert(out.defi_positions.end(),
                                      std::make_move_iterator(comp.begin()),
                                      std::make_move_iterator(comp.end()));
        } catch (const std::exception& e) {
            out.warnings.push_back(std::string("[") + cfg.key + "] compound-v3: " + e.what());
        }
        try {
            auto uni = defi::scan_uniswap_v3(rpc, cfg, wallet);
            out.defi_positions.insert(out.defi_positions.end(),
                                      std::make_move_iterator(uni.begin()),
                                      std::make_move_iterator(uni.end()));
        } catch (const std::exception& e) {
            out.warnings.push_back(std::string("[") + cfg.key + "] uniswap-v3: " + e.what());
        }
    }
    return out;
}

}  // namespace

PortfolioScanner::PortfolioScanner(const chain::Registry& registry,
                                   std::shared_ptr<util::HttpClient> http,
                                   std::shared_ptr<pricing::PriceService> prices,
                                   std::shared_ptr<pricing::FxService> fx)
    : registry_(registry),
      http_(std::move(http)),
      prices_(std::move(prices)),
      fx_(std::move(fx)) {}

ScanResult PortfolioScanner::scan(const chain::Address& wallet, const ScanOptions& opts) {
    ScanResult res;

    // Fan out per-chain scans on a small thread pool.
    const auto& chains = registry_.chains();
    std::vector<std::future<ChainScanResult>> futs;
    futs.reserve(chains.size());

    // Cap concurrency; std::async with launch::async typically uses one thread per task,
    // so we batch in waves.
    int conc = std::max(1, opts.concurrency);
    for (std::size_t i = 0; i < chains.size(); i += static_cast<std::size_t>(conc)) {
        std::size_t end = std::min(chains.size(), i + static_cast<std::size_t>(conc));
        futs.clear();
        for (std::size_t j = i; j < end; ++j) {
            const auto& cfg = chains[j];
            const bool scan_defi = opts.scan_defi;
            futs.push_back(std::async(std::launch::async, [&cfg, &wallet, this, scan_defi] {
                return scan_chain(cfg, wallet, http_, scan_defi);
            }));
        }
        for (auto& f : futs) {
            auto cr = f.get();
            for (auto& h : cr.holdings) res.holdings.push_back(std::move(h));
            for (auto& p : cr.defi_positions) res.defi_positions.push_back(std::move(p));
            for (auto& w : cr.warnings) res.warnings.push_back(std::move(w));
        }
    }

    // Drop zero balances unless caller wants them.
    if (!opts.include_zero) {
        res.holdings.erase(
            std::remove_if(res.holdings.begin(), res.holdings.end(),
                           [](const Holding& h) { return h.raw_balance == 0; }),
            res.holdings.end());
    }

    if (!opts.fetch_prices) return res;

    // Collect unique coingecko ids from BOTH holdings and DeFi LP token pairs,
    // price them all in one shot.
    std::set<std::string> ids;
    for (const auto& h : res.holdings) {
        if (!h.coingecko_id.empty()) ids.insert(h.coingecko_id);
    }
    for (const auto& p : res.defi_positions) {
        if (!p.token0_coingecko_id.empty()) ids.insert(p.token0_coingecko_id);
        if (!p.token1_coingecko_id.empty()) ids.insert(p.token1_coingecko_id);
    }
    std::vector<std::string> id_vec(ids.begin(), ids.end());
    auto price_map = prices_->usd_prices(id_vec);
    auto rub_rate = fx_->usd_to_rub().value_or(0.0);
    res.usd_rub_rate = rub_rate;

    for (auto& h : res.holdings) {
        auto it = price_map.find(h.coingecko_id);
        if (it != price_map.end()) {
            h.price_usd = it->second;
            double amt = chain::to_double_units(h.raw_balance, h.decimals);
            h.value_usd = amt * h.price_usd;
            h.value_rub = h.value_usd * rub_rate;
            res.total_usd += h.value_usd;
            res.total_rub += h.value_rub;
        }
    }

    // USD valuation for Uniswap V3 LP positions and Aave V3 per-token rows.
    // Both populate amount0_raw/decimals0/coingecko_id; LP also amount1.
    for (auto& p : res.defi_positions) {
        if (p.kind != "lp" && p.kind != "supply" && p.kind != "borrow") continue;
        double v_usd = 0;
        if (!p.token0_coingecko_id.empty()) {
            auto it = price_map.find(p.token0_coingecko_id);
            if (it != price_map.end() && p.amount0_raw != 0) {
                v_usd += chain::to_double_units(p.amount0_raw, p.decimals0) * it->second;
            }
        }
        if (!p.token1_coingecko_id.empty()) {
            auto it = price_map.find(p.token1_coingecko_id);
            if (it != price_map.end() && p.amount1_raw != 0) {
                v_usd += chain::to_double_units(p.amount1_raw, p.decimals1) * it->second;
            }
        }
        // Only overwrite when we actually computed a number — otherwise keep
        // whatever the protocol scanner pre-filled (e.g. Aave's USD figure).
        if (v_usd > 0) {
            p.value_usd = v_usd;
            p.value_rub = v_usd * rub_rate;
        }
    }

    // Sort holdings by USD value desc — most valuable on top.
    std::sort(res.holdings.begin(), res.holdings.end(),
              [](const Holding& a, const Holding& b) {
                  return a.value_usd > b.value_usd;
              });

    // Aave reports collateral/debt directly in USD; LP value comes from token amounts.
    // Fold both into totals.
    for (const auto& p : res.defi_positions) {
        if (p.value_usd <= 0) continue;
        if (p.kind == "supply" || p.kind == "lp") {
            res.total_usd += p.value_usd;
            res.total_rub += p.value_usd * rub_rate;
        } else if (p.kind == "borrow") {
            res.total_usd -= p.value_usd;
            res.total_rub -= p.value_usd * rub_rate;
        }
    }

    // Sort DeFi positions: chain (asc), kind, then value desc.
    std::sort(res.defi_positions.begin(), res.defi_positions.end(),
              [](const defi::DefiPosition& a, const defi::DefiPosition& b) {
                  if (a.chain_key != b.chain_key) return a.chain_key < b.chain_key;
                  if (a.protocol != b.protocol) return a.protocol < b.protocol;
                  return a.value_usd > b.value_usd;
              });
    return res;
}

}  // namespace cryptoapp::portfolio

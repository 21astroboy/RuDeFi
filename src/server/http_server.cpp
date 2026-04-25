#include "cryptoapp/server/http_server.hpp"

#include "cryptoapp/chain/eth_types.hpp"
#include "cryptoapp/portfolio/scan_json.hpp"

#include <future>
#include <mutex>
#include <unordered_map>

#include <httplib.h>
#include <nlohmann/json.hpp>

#include <iostream>

namespace cryptoapp::server {

struct HttpServer::Impl {
    ServerDeps deps;
    ServeOptions opts;
    httplib::Server srv;
};

namespace {

// Native (gas) tokens use a sentinel address in LiFi requests.
const std::string LIFI_NATIVE_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

nlohmann::json registry_to_json(const chain::Registry& reg) {
    nlohmann::json out;
    out["chains"] = nlohmann::json::array();
    for (const auto& c : reg.chains()) {
        nlohmann::json cj;
        cj["key"] = c.key;
        cj["name"] = c.name;
        cj["chain_id"] = c.chain_id;
        cj["native_symbol"] = c.native_symbol;
        cj["native_decimals"] = c.native_decimals;
        cj["explorer"] = c.explorer;
        // DeFi protocol addresses for in-app actions (deposit, etc.).
        cj["aave_v3_pool"] = c.aave_v3_pool.is_zero() ? std::string{} : c.aave_v3_pool.hex();
        cj["spark_pool"]   = c.spark_pool.is_zero()   ? std::string{} : c.spark_pool.hex();
        nlohmann::json comp = nlohmann::json::array();
        for (const auto& m : c.compound_v3_markets) {
            comp.push_back({
                {"base_symbol", m.base_symbol},
                {"base_address", m.base_address.hex()},
                {"base_decimals", m.base_decimals},
                {"comet", m.comet.hex()},
            });
        }
        cj["compound_v3_markets"] = std::move(comp);

        nlohmann::json tokens = nlohmann::json::array();
        // Native first — using the LiFi sentinel address so the UI can pass it
        // straight through to /api/bridge/quote.
        tokens.push_back({
            {"symbol", c.native_symbol},
            {"address", LIFI_NATIVE_ADDRESS},
            {"decimals", c.native_decimals},
            {"is_native", true},
        });
        for (const auto& t : c.tokens) {
            tokens.push_back({
                {"symbol", t.symbol},
                {"address", t.address.hex()},
                {"decimals", t.decimals},
                {"is_native", false},
            });
        }
        cj["tokens"] = std::move(tokens);
        out["chains"].push_back(std::move(cj));
    }
    return out;
}

nlohmann::json bridge_result_to_json(const bridges::BridgeQuoteResult& r,
                                     double rub_rate) {
    nlohmann::json j;
    j["error"] = r.error;
    j["usd_rub_rate"] = rub_rate;
    j["routes"] = nlohmann::json::array();
    for (const auto& rt : r.routes) {
        nlohmann::json route;
        route["id"] = rt.id;
        route["route_id"] = rt.id;   // explicit alias for the executor
        route["from_token_symbol"] = rt.from_token_symbol;
        route["to_token_symbol"]   = rt.to_token_symbol;
        route["from_amount_human"] = rt.from_amount_human;
        route["to_amount_human"]   = rt.to_amount_human;
        route["from_amount_usd"]   = rt.from_amount_usd;
        route["to_amount_usd"]     = rt.to_amount_usd;
        route["execution_duration_seconds"] = rt.execution_duration_seconds;
        route["total_gas_usd"]     = rt.total_gas_usd;
        route["total_gas_rub"]     = rt.total_gas_usd * rub_rate;
        route["tags"] = rt.tags;

        nlohmann::json steps = nlohmann::json::array();
        for (const auto& s : rt.steps) {
            steps.push_back({
                {"protocol", s.protocol},
                {"protocol_logo", s.protocol_logo},
            });
        }
        route["steps"] = std::move(steps);

        nlohmann::json gas = nlohmann::json::array();
        // Aggregate gas tokens with the same symbol so the UI can show one
        // line per token (e.g. "0.0021 ETH" instead of "0.001 + 0.0011").
        std::vector<bridges::GasCost> aggregated;
        for (const auto& g : rt.gas_breakdown) {
            bool merged = false;
            for (auto& a : aggregated) {
                if (a.token_symbol == g.token_symbol) {
                    a.amount_human += g.amount_human;
                    a.amount_usd   += g.amount_usd;
                    merged = true;
                    break;
                }
            }
            if (!merged) aggregated.push_back(g);
        }
        for (const auto& g : aggregated) {
            gas.push_back({
                {"token_symbol", g.token_symbol},
                {"amount_human", g.amount_human},
                {"amount_usd",   g.amount_usd},
                {"amount_rub",   g.amount_usd * rub_rate},
            });
        }
        route["gas_breakdown"] = std::move(gas);

        j["routes"].push_back(std::move(route));
    }
    return j;
}

}  // namespace

HttpServer::HttpServer(ServerDeps deps, ServeOptions opts)
    : impl_(std::make_unique<Impl>()) {
    impl_->deps = std::move(deps);
    impl_->opts = std::move(opts);

    auto& srv = impl_->srv;
    const auto& origin = impl_->opts.allowed_origin;

    srv.set_default_headers({
        {"Access-Control-Allow-Origin", origin},
        {"Access-Control-Allow-Methods", "GET, OPTIONS"},
        {"Access-Control-Allow-Headers", "Content-Type"},
        {"Cache-Control", "no-store"},
    });
    srv.Options(R"(/api/.*)", [](const httplib::Request&, httplib::Response& res) {
        res.status = 204;
    });

    srv.Get("/api/healthz", [](const httplib::Request&, httplib::Response& res) {
        res.set_content("{\"ok\":true}", "application/json");
    });

    // Expose chains/tokens for UI dropdowns.
    srv.Get("/api/registry", [this](const httplib::Request&, httplib::Response& res) {
        if (!impl_->deps.registry) {
            res.status = 500;
            res.set_content("{\"error\":\"registry not configured\"}", "application/json");
            return;
        }
        res.set_content(registry_to_json(*impl_->deps.registry).dump(), "application/json");
    });

    srv.Get("/api/scan", [this](const httplib::Request& req, httplib::Response& res) {
        if (!req.has_param("wallet")) {
            res.status = 400;
            res.set_content("{\"error\":\"missing 'wallet' query param\"}", "application/json");
            return;
        }
        const auto wallet_str = req.get_param_value("wallet");
        chain::Address wallet;
        try {
            wallet = chain::Address::from_hex(wallet_str);
        } catch (const std::exception& e) {
            res.status = 400;
            nlohmann::json err = {{"error", std::string("bad address: ") + e.what()}};
            res.set_content(err.dump(), "application/json");
            return;
        }

        portfolio::ScanOptions opts;
        opts.include_zero = req.has_param("include_zero")
                            && req.get_param_value("include_zero") == "1";
        opts.fetch_prices = !(req.has_param("no_prices")
                            && req.get_param_value("no_prices") == "1");

        try {
            auto result = impl_->deps.scanner->scan(wallet, opts);
            res.set_content(portfolio::scan_result_to_json(result).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 500;
            nlohmann::json err = {{"error", e.what()}};
            res.set_content(err.dump(), "application/json");
        }
    });

    // Cross-chain bridge quote via LiFi.
    srv.Get("/api/bridge/quote", [this](const httplib::Request& req, httplib::Response& res) {
        auto need = [&](const char* k) -> std::string {
            if (!req.has_param(k)) {
                throw std::runtime_error(std::string("missing query param: ") + k);
            }
            return req.get_param_value(k);
        };
        try {
            if (!impl_->deps.lifi) {
                throw std::runtime_error("LiFi client not configured");
            }
            bridges::BridgeQuoteRequest q;
            q.from_chain_id = std::stoull(need("from_chain"));
            q.to_chain_id   = std::stoull(need("to_chain"));
            q.from_token    = need("from_token");
            q.to_token      = need("to_token");
            q.from_amount   = need("amount");
            q.from_address  = req.has_param("from_address")
                              ? req.get_param_value("from_address")
                              : "0x0000000000000000000000000000000000000000";
            if (req.has_param("slippage")) {
                try { q.slippage = std::stod(req.get_param_value("slippage")); } catch (...) {}
            }
            auto r = impl_->deps.lifi->get_routes(q);
            double rub = impl_->deps.fx ? impl_->deps.fx->usd_to_rub().value_or(0.0) : 0.0;
            res.set_content(bridge_result_to_json(r, rub).dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            nlohmann::json err = {{"error", e.what()}};
            res.set_content(err.dump(), "application/json");
        }
    });

    // Token security check via GoPlus.
    srv.Get("/api/security/token", [this](const httplib::Request& req, httplib::Response& res) {
        try {
            if (!impl_->deps.goplus) throw std::runtime_error("goplus not configured");
            if (!req.has_param("chain") || !req.has_param("address"))
                throw std::runtime_error("need chain & address params");
            const std::string chain_key = req.get_param_value("chain");
            const std::string addr      = req.get_param_value("address");
            if (!impl_->deps.registry) throw std::runtime_error("registry not configured");
            const auto* cfg = impl_->deps.registry->find(chain_key);
            if (!cfg) throw std::runtime_error("unknown chain: " + chain_key);
            auto sec = impl_->deps.goplus->check(chain_key, cfg->chain_id, addr);
            // If this token is in our curated tokens.json — we vouch for it
            // ourselves. Generic GoPlus heuristics (proxy, low holders, etc.)
            // become noise on canonical wrappers like USDC / WETH on L2s.
            // We only override "warn" — anything truly bad (honeypot, large
            // sell-tax) still gets surfaced.
            try {
                auto wanted = chain::Address::from_hex(addr);
                bool curated = false;
                for (const auto& t : cfg->tokens) {
                    if (t.address == wanted) { curated = true; break; }
                }
                if (curated && sec.verdict == "warn") {
                    sec.verdict = "ok";
                    sec.verdict_reason = "токен в нашем доверенном списке";
                }
            } catch (...) { /* unparsable addr — leave verdict alone */ }
            nlohmann::json j = {
                {"chain_key", sec.chain_key},
                {"token_address", sec.token_address},
                {"token_name", sec.token_name},
                {"token_symbol", sec.token_symbol},
                {"verdict", sec.verdict},
                {"verdict_reason", sec.verdict_reason},
                {"is_open_source", sec.is_open_source},
                {"is_proxy", sec.is_proxy},
                {"is_honeypot", sec.is_honeypot},
                {"transfer_pausable", sec.transfer_pausable},
                {"can_take_back_ownership", sec.can_take_back_ownership},
                {"owner_change_balance", sec.owner_change_balance},
                {"hidden_owner", sec.hidden_owner},
                {"selfdestruct", sec.selfdestruct},
                {"is_blacklisted", sec.is_blacklisted},
                {"is_whitelisted", sec.is_whitelisted},
                {"slippage_modifiable", sec.slippage_modifiable},
                {"buy_tax", sec.buy_tax},
                {"sell_tax", sec.sell_tax},
                {"holders", sec.holders},
                {"lp_holders", sec.lp_holders},
            };
            res.set_content(j.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            nlohmann::json err = {{"error", e.what()}};
            res.set_content(err.dump(), "application/json");
        }
    });

    // Approvals scan: list non-zero allowances across known spenders.
    srv.Get("/api/approvals", [this](const httplib::Request& req, httplib::Response& res) {
        try {
            if (!impl_->deps.approvals) throw std::runtime_error("approvals scanner not configured");
            if (!req.has_param("wallet")) throw std::runtime_error("missing wallet");
            auto wallet = chain::Address::from_hex(req.get_param_value("wallet"));
            auto items = impl_->deps.approvals->scan(wallet);
            nlohmann::json j;
            j["approvals"] = nlohmann::json::array();
            for (const auto& a : items) {
                j["approvals"].push_back({
                    {"chain_key", a.chain_key},
                    {"chain_name", a.chain_name},
                    {"token_symbol", a.token_symbol},
                    {"token_address", a.token_address.hex()},
                    {"token_decimals", a.token_decimals},
                    {"spender_label", a.spender_label},
                    {"spender_address", a.spender_address.hex()},
                    {"allowance_human", a.allowance_human},
                    {"unlimited", a.unlimited},
                });
            }
            res.set_content(j.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            nlohmann::json err = {{"error", e.what()}};
            res.set_content(err.dump(), "application/json");
        }
    });

    // Current gas snapshot across chains.
    srv.Get("/api/gas", [this](const httplib::Request&, httplib::Response& res) {
        if (!impl_->deps.gas) {
            res.status = 500;
            res.set_content("{\"error\":\"gas tracker not configured\"}", "application/json");
            return;
        }
        auto snap = impl_->deps.gas->snapshot();
        nlohmann::json j;
        j["chains"] = nlohmann::json::array();
        for (const auto& g : snap) {
            j["chains"].push_back({
                {"chain_key", g.chain_key},
                {"chain_name", g.chain_name},
                {"native_symbol", g.native_symbol},
                {"gwei", g.gwei},
                {"level", g.level},
                {"error", g.error},
            });
        }
        res.set_content(j.dump(), "application/json");
    });

    // Yield-pool scan via DeFiLlama Yields. Query params:
    //   symbols=USDC,USDT,WETH   (CSV; case-insensitive)
    //   chains=ethereum,arbitrum (CSV of chain keys)
    //   min_tvl=1000000          (USD)
    //   min_apy=2                (percent)
    //   stable_only=1
    //   single_only=1            (skip LP / multi-exposure)
    //   no_il=1                  (skip pools with IL risk)
    //   limit=50
    srv.Get("/api/yield/scan", [this](const httplib::Request& req, httplib::Response& res) {
        try {
            if (!impl_->deps.yields) throw std::runtime_error("yield client not configured");
            auto split_csv = [](const std::string& s) {
                std::set<std::string> out; std::string cur;
                for (char c : s) {
                    if (c == ',') { if (!cur.empty()) out.insert(cur); cur.clear(); }
                    else cur.push_back(c);
                }
                if (!cur.empty()) out.insert(cur);
                return out;
            };
            yield::YieldQuery q;
            if (req.has_param("symbols")) q.symbols    = split_csv(req.get_param_value("symbols"));
            if (req.has_param("chains"))  q.chain_keys = split_csv(req.get_param_value("chains"));
            if (req.has_param("min_tvl")) q.min_tvl_usd = std::stod(req.get_param_value("min_tvl"));
            if (req.has_param("min_apy")) q.min_apy_pct = std::stod(req.get_param_value("min_apy"));
            if (req.has_param("stable_only") && req.get_param_value("stable_only") == "1")
                q.stable_only = true;
            if (req.has_param("single_only") && req.get_param_value("single_only") == "1")
                q.single_exposure_only = true;
            if (req.has_param("no_il") && req.get_param_value("no_il") == "1")
                q.no_il_only = true;
            if (req.has_param("limit")) q.max_results = std::stoi(req.get_param_value("limit"));

            auto pools = impl_->deps.yields->scan(q);

            nlohmann::json out;
            out["total"]  = pools.size();
            out["cached"] = impl_->deps.yields->cache_size();
            out["pools"]  = nlohmann::json::array();
            for (const auto& p : pools) {
                out["pools"].push_back({
                    {"chain_key",     p.chain_key},
                    {"project",       p.project},
                    {"symbol",        p.symbol},
                    {"pool_id",       p.pool_id},
                    {"tvl_usd",       p.tvl_usd},
                    {"apy",           p.apy},
                    {"apy_base",      p.apy_base},
                    {"apy_reward",    p.apy_reward},
                    {"apy_mean_30d",  p.apy_mean_30d},
                    {"stablecoin",    p.stablecoin},
                    {"il_risk",       p.il_risk},
                    {"exposure",      p.exposure},
                    {"url", "https://defillama.com/yields/pool/" + p.pool_id},
                });
            }
            res.set_content(out.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            nlohmann::json err = {{"error", e.what()}};
            res.set_content(err.dump(), "application/json");
        }
    });

    // Build a transaction-request for executing a chosen route step.
    // Client passes route_id (from /api/bridge/quote) and step index.
    srv.Get("/api/bridge/build-tx", [this](const httplib::Request& req, httplib::Response& res) {
        try {
            if (!impl_->deps.lifi) throw std::runtime_error("LiFi not configured");
            if (!req.has_param("route_id"))
                throw std::runtime_error("missing route_id");
            const std::string id = req.get_param_value("route_id");
            std::size_t step = 0;
            if (req.has_param("step")) step = std::stoul(req.get_param_value("step"));
            std::string err;
            auto tx = impl_->deps.lifi->build_step_transaction(id, step, err);
            if (!err.empty()) {
                res.status = 400;
                nlohmann::json j = {{"error", err}};
                res.set_content(j.dump(), "application/json");
                return;
            }
            res.set_content(tx.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            nlohmann::json err = {{"error", e.what()}};
            res.set_content(err.dump(), "application/json");
        }
    });

    // Poll cross-chain transaction status. After we send the bridge tx on the
    // source chain, we poll this until status == "DONE" or "FAILED".
    srv.Get("/api/bridge/status", [this](const httplib::Request& req, httplib::Response& res) {
        try {
            if (!impl_->deps.lifi) throw std::runtime_error("LiFi not configured");
            if (!req.has_param("tx_hash")) throw std::runtime_error("missing tx_hash");
            const std::string tx_hash = req.get_param_value("tx_hash");
            const std::string bridge  = req.has_param("bridge")
                                         ? req.get_param_value("bridge") : std::string{};
            std::uint64_t from_chain = req.has_param("from_chain")
                                         ? std::stoull(req.get_param_value("from_chain")) : 0ULL;
            std::uint64_t to_chain   = req.has_param("to_chain")
                                         ? std::stoull(req.get_param_value("to_chain")) : 0ULL;
            std::string err;
            auto j = impl_->deps.lifi->get_status(bridge, from_chain, to_chain, tx_hash, err);
            if (!err.empty()) {
                res.status = 502;
                nlohmann::json e = {{"error", err}};
                res.set_content(e.dump(), "application/json");
                return;
            }
            res.set_content(j.dump(), "application/json");
        } catch (const std::exception& e) {
            res.status = 400;
            nlohmann::json err = {{"error", e.what()}};
            res.set_content(err.dump(), "application/json");
        }
    });

    if (!impl_->opts.ui_dir.empty()) {
        if (!srv.set_mount_point("/", impl_->opts.ui_dir.string())) {
            std::cerr << "warn: failed to mount UI dir " << impl_->opts.ui_dir << "\n";
        }
    }

    srv.set_logger([](const httplib::Request& req, const httplib::Response& res) {
        std::cerr << req.method << " " << req.path << " -> " << res.status << "\n";
    });
}

HttpServer::~HttpServer() = default;

void HttpServer::run() {
    const auto& o = impl_->opts;
    std::cerr << "cryptoapp listening on http://" << o.bind_addr << ":" << o.port << "\n";
    if (!o.ui_dir.empty()) {
        std::cerr << "  UI: open http://" << o.bind_addr << ":" << o.port << "/\n";
    }
    if (!impl_->srv.listen(o.bind_addr.c_str(), o.port)) {
        throw std::runtime_error("HTTP server failed to bind " + o.bind_addr +
                                 ":" + std::to_string(o.port));
    }
}

void HttpServer::stop() { impl_->srv.stop(); }

}  // namespace cryptoapp::server

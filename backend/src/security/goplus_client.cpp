#include "cryptoapp/security/goplus_client.hpp"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cctype>

namespace cryptoapp::security {

namespace {

bool to_bool(const nlohmann::json& v) {
    if (v.is_boolean()) return v.get<bool>();
    if (v.is_string()) {
        const auto& s = v.get_ref<const std::string&>();
        return s == "1" || s == "true" || s == "yes";
    }
    if (v.is_number_integer()) return v.get<int>() != 0;
    return false;
}
double to_d(const nlohmann::json& v) {
    if (v.is_number()) return v.get<double>();
    if (v.is_string()) {
        try { return std::stod(v.get<std::string>()); } catch (...) {}
    }
    return 0.0;
}
int to_i(const nlohmann::json& v) {
    if (v.is_number_integer()) return v.get<int>();
    if (v.is_string()) {
        try { return std::stoi(v.get<std::string>()); } catch (...) {}
    }
    return 0;
}

std::string lower(std::string s) {
    for (auto& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    return s;
}

// Roll up the dozens of GoPlus signals into one of three buckets so the UI
// stays readable. "bad" = clear scam markers; "warn" = suspicious but not
// fatal; "ok" = nothing alarming.
void compute_verdict(TokenSecurity& s) {
    if (s.is_honeypot) {
        s.verdict = "bad";
        s.verdict_reason = "honeypot — нельзя продать токен";
        return;
    }
    if (s.sell_tax >= 0.10 || s.buy_tax >= 0.10) {
        s.verdict = "bad";
        s.verdict_reason = "крупный налог на продажу/покупку (>10%)";
        return;
    }
    if (s.can_take_back_ownership || s.hidden_owner || s.selfdestruct) {
        s.verdict = "bad";
        s.verdict_reason = "контракт может быть взят под полный контроль или удалён";
        return;
    }

    std::vector<std::string> warns;
    if (!s.is_open_source) warns.push_back("исходный код не верифицирован");
    if (s.is_proxy) warns.push_back("upgradeable proxy — логика может быть заменена");
    if (s.transfer_pausable) warns.push_back("переводы можно поставить на паузу");
    if (s.owner_change_balance) warns.push_back("владелец может менять балансы");
    if (s.is_blacklisted) warns.push_back("адрес в blacklist'е");
    if (s.slippage_modifiable) warns.push_back("комиссия меняется");
    if (s.sell_tax > 0.02 || s.buy_tax > 0.02) {
        char buf[64];
        std::snprintf(buf, sizeof(buf), "налоги: buy %.1f%% / sell %.1f%%",
                      s.buy_tax * 100, s.sell_tax * 100);
        warns.push_back(buf);
    }
    if (s.holders < 100 && s.holders > 0) warns.push_back("мало держателей (<100)");

    if (!warns.empty()) {
        s.verdict = "warn";
        std::string r = warns[0];
        for (std::size_t i = 1; i < warns.size() && i < 3; ++i) r += "; " + warns[i];
        s.verdict_reason = r;
    } else {
        s.verdict = "ok";
        s.verdict_reason = "без явных проблем";
    }
}

}  // namespace

GoplusClient::GoplusClient(std::shared_ptr<util::HttpClient> http,
                           std::chrono::minutes ttl)
    : http_(std::move(http)), ttl_(ttl) {}

TokenSecurity GoplusClient::check(const std::string& chain_key,
                                  std::uint64_t chain_id,
                                  const std::string& token_address) {
    const std::string key = std::to_string(chain_id) + "|" + lower(token_address);
    const auto now = std::chrono::steady_clock::now();
    {
        std::lock_guard<std::mutex> lk(mtx_);
        auto it = cache_.find(key);
        if (it != cache_.end() && now - it->second.at < ttl_) {
            return it->second.result;
        }
    }

    TokenSecurity out;
    out.chain_key = chain_key;
    out.token_address = lower(token_address);

    // Sentinel for native ETH → can't analyze, return a benign verdict.
    if (out.token_address == "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
        out.token_address == "0x0000000000000000000000000000000000000000") {
        out.verdict = "ok";
        out.verdict_reason = "нативный токен сети";
        std::lock_guard<std::mutex> lk(mtx_);
        cache_[key] = {out, now};
        return out;
    }

    const std::string url =
        "https://api.gopluslabs.io/api/v1/token_security/" + std::to_string(chain_id) +
        "?contract_addresses=" + out.token_address;

    auto resp = http_->get(url);
    if (!resp.ok()) {
        out.verdict = "unknown";
        out.verdict_reason = "GoPlus недоступен";
        out.raw_error = resp.error;
        return out;
    }

    nlohmann::json j;
    try { j = nlohmann::json::parse(resp.body); }
    catch (...) {
        out.verdict = "unknown";
        out.verdict_reason = "не удалось разобрать ответ";
        return out;
    }

    if (!j.contains("result") || !j["result"].is_object()) {
        out.verdict = "unknown";
        out.verdict_reason = "GoPlus не знает про этот токен";
        std::lock_guard<std::mutex> lk(mtx_);
        cache_[key] = {out, now};
        return out;
    }

    // GoPlus returns the data nested under the (lowercased) contract address.
    const auto& res = j["result"];
    nlohmann::json data;
    for (auto it = res.begin(); it != res.end(); ++it) {
        if (lower(it.key()) == out.token_address) { data = it.value(); break; }
    }
    if (!data.is_object()) {
        out.verdict = "unknown";
        out.verdict_reason = "GoPlus не знает про этот токен";
        std::lock_guard<std::mutex> lk(mtx_);
        cache_[key] = {out, now};
        return out;
    }

    out.token_name   = data.value("token_name", "");
    out.token_symbol = data.value("token_symbol", "");
    out.is_open_source = to_bool(data.value("is_open_source", nlohmann::json{}));
    out.is_proxy = to_bool(data.value("is_proxy", nlohmann::json{}));
    out.is_honeypot = to_bool(data.value("is_honeypot", nlohmann::json{}));
    out.transfer_pausable = to_bool(data.value("transfer_pausable", nlohmann::json{}));
    out.can_take_back_ownership = to_bool(data.value("can_take_back_ownership", nlohmann::json{}));
    out.owner_change_balance = to_bool(data.value("owner_change_balance", nlohmann::json{}));
    out.hidden_owner = to_bool(data.value("hidden_owner", nlohmann::json{}));
    out.selfdestruct = to_bool(data.value("selfdestruct", nlohmann::json{}));
    out.is_blacklisted = to_bool(data.value("is_blacklisted", nlohmann::json{}));
    out.is_whitelisted = to_bool(data.value("is_whitelisted", nlohmann::json{}));
    out.slippage_modifiable = to_bool(data.value("slippage_modifiable", nlohmann::json{}));
    out.personal_slippage_modifiable =
        to_bool(data.value("personal_slippage_modifiable", nlohmann::json{}));
    out.external_call = to_bool(data.value("external_call", nlohmann::json{}));

    out.buy_tax  = to_d(data.value("buy_tax",  nlohmann::json{}));
    out.sell_tax = to_d(data.value("sell_tax", nlohmann::json{}));
    out.holders     = to_i(data.value("holder_count",   nlohmann::json{}));
    out.lp_holders  = to_i(data.value("lp_holder_count", nlohmann::json{}));

    compute_verdict(out);

    std::lock_guard<std::mutex> lk(mtx_);
    cache_[key] = {out, now};
    return out;
}

}  // namespace cryptoapp::security

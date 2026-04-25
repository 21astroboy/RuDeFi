// http.hpp - Minimal libcurl-backed HTTP client.
#pragma once

#include <chrono>
#include <map>
#include <string>
#include <string_view>

namespace cryptoapp::util {

struct HttpResponse {
    long status = 0;
    std::string body;
    std::string error;  // populated only on transport-level failure
    [[nodiscard]] bool ok() const { return error.empty() && status >= 200 && status < 300; }
};

struct HttpClientOptions {
    std::chrono::milliseconds timeout{std::chrono::milliseconds(8000)};
    std::chrono::milliseconds connect_timeout{std::chrono::milliseconds(3000)};
    int max_retries = 2;        // retry transient failures with backoff
    bool follow_redirects = true;
    std::string user_agent = "cryptoapp/0.1 (+https://github.com/yourname/cryptoapp)";
};

class HttpClient {
public:
    explicit HttpClient(HttpClientOptions opts = {});
    ~HttpClient();
    HttpClient(const HttpClient&) = delete;
    HttpClient& operator=(const HttpClient&) = delete;

    // POST JSON body. Returns the response.
    [[nodiscard]] HttpResponse post_json(std::string_view url, std::string_view json_body) const;
    // GET with optional query (already appended to url).
    [[nodiscard]] HttpResponse get(std::string_view url) const;

private:
    HttpClientOptions opts_;
};

// One-time global init/cleanup (libcurl). Safe to call multiple times.
void http_global_init();
void http_global_cleanup();

}  // namespace cryptoapp::util

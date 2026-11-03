#include "cryptoapp/util/http.hpp"

#include <curl/curl.h>

#include <atomic>
#include <mutex>
#include <stdexcept>
#include <thread>

namespace cryptoapp::util {

namespace {

std::once_flag g_init_once;
std::atomic<bool> g_initialized{false};

std::size_t write_cb(char* ptr, std::size_t size, std::size_t nmemb, void* userdata) noexcept {
    auto* str = static_cast<std::string*>(userdata);
    const std::size_t total = size * nmemb;
    try {
        str->append(ptr, total);
    } catch (...) {
        return 0;  // signal failure to libcurl
    }
    return total;
}

HttpResponse perform(const HttpClientOptions& opts,
                     std::string_view url,
                     bool is_post,
                     std::string_view body,
                     const char* content_type) {
    HttpResponse resp;
    CURL* c = curl_easy_init();
    if (!c) {
        resp.error = "curl_easy_init failed";
        return resp;
    }

    std::string url_str(url);
    std::string body_str(body);

    curl_easy_setopt(c, CURLOPT_URL, url_str.c_str());
    curl_easy_setopt(c, CURLOPT_TIMEOUT_MS, static_cast<long>(opts.timeout.count()));
    curl_easy_setopt(c, CURLOPT_CONNECTTIMEOUT_MS, static_cast<long>(opts.connect_timeout.count()));
    curl_easy_setopt(c, CURLOPT_FOLLOWLOCATION, opts.follow_redirects ? 1L : 0L);
    curl_easy_setopt(c, CURLOPT_USERAGENT, opts.user_agent.c_str());
    curl_easy_setopt(c, CURLOPT_NOPROGRESS, 1L);
    curl_easy_setopt(c, CURLOPT_WRITEFUNCTION, write_cb);
    curl_easy_setopt(c, CURLOPT_WRITEDATA, &resp.body);
    // Reasonable TLS defaults; users should keep CA bundle current.
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(c, CURLOPT_SSL_VERIFYHOST, 2L);
    // HTTP/2 if available (low-latency win for keep-alive multiplexing).
    curl_easy_setopt(c, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_2TLS);

    struct curl_slist* headers = nullptr;
    if (is_post) {
        curl_easy_setopt(c, CURLOPT_POST, 1L);
        curl_easy_setopt(c, CURLOPT_POSTFIELDS, body_str.c_str());
        curl_easy_setopt(c, CURLOPT_POSTFIELDSIZE, static_cast<long>(body_str.size()));
        if (content_type) {
            std::string ct = std::string("Content-Type: ") + content_type;
            headers = curl_slist_append(headers, ct.c_str());
        }
        headers = curl_slist_append(headers, "Accept: application/json");
        curl_easy_setopt(c, CURLOPT_HTTPHEADER, headers);
    } else {
        headers = curl_slist_append(headers, "Accept: application/json");
        curl_easy_setopt(c, CURLOPT_HTTPHEADER, headers);
    }

    CURLcode rc = curl_easy_perform(c);
    if (rc != CURLE_OK) {
        resp.error = curl_easy_strerror(rc);
    } else {
        long code = 0;
        curl_easy_getinfo(c, CURLINFO_RESPONSE_CODE, &code);
        resp.status = code;
    }

    if (headers) curl_slist_free_all(headers);
    curl_easy_cleanup(c);
    return resp;
}

HttpResponse perform_with_retries(const HttpClientOptions& opts,
                                  std::string_view url,
                                  bool is_post,
                                  std::string_view body,
                                  const char* content_type) {
    HttpResponse last;
    int attempts = std::max(1, opts.max_retries + 1);
    std::chrono::milliseconds backoff{200};
    for (int i = 0; i < attempts; ++i) {
        last = perform(opts, url, is_post, body, content_type);
        if (last.ok()) return last;
        // Retry on network errors and 5xx / 429.
        bool transient = !last.error.empty() || last.status == 429 ||
                         (last.status >= 500 && last.status < 600);
        if (!transient || i == attempts - 1) return last;
        std::this_thread::sleep_for(backoff);
        backoff *= 2;
    }
    return last;
}

}  // namespace

void http_global_init() {
    std::call_once(g_init_once, [] {
        if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) {
            throw std::runtime_error("curl_global_init failed");
        }
        g_initialized.store(true);
    });
}

void http_global_cleanup() {
    if (g_initialized.exchange(false)) {
        curl_global_cleanup();
    }
}

HttpClient::HttpClient(HttpClientOptions opts) : opts_(std::move(opts)) {
    http_global_init();
}

HttpClient::~HttpClient() = default;

HttpResponse HttpClient::post_json(std::string_view url, std::string_view json_body) const {
    return perform_with_retries(opts_, url, /*is_post=*/true, json_body, "application/json");
}

HttpResponse HttpClient::get(std::string_view url) const {
    return perform_with_retries(opts_, url, /*is_post=*/false, {}, nullptr);
}

}  // namespace cryptoapp::util

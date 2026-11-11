#!/usr/bin/env bash
# MedAI Hospital — post-deploy smoke test.
#
#   ./scripts/render_smoke.sh                      # uses the default API URL
#   ./scripts/render_smoke.sh https://my-api.example.com
#
# Exits 0 when every check passes, 1 otherwise, so it can gate a release.

set -uo pipefail

API="${1:-https://medaionline-1.onrender.com}"
API="${API%/}"
SITE="${2:-https://medaionline-1.onrender.com}"
fails=0

# http URL [outfile] [extra curl args...]  → prints the status code (000 if unreachable)
http() {
  local url="$1" out="${2:-/dev/null}"; shift 2 2>/dev/null || shift 1
  local c
  c=$(curl -s -o "$out" -w '%{http_code}' --max-time 30 "$@" "$url" 2>/dev/null)
  printf '%s' "${c:-000}"
}

ok()   { printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fails=$((fails+1)); }
head2(){ printf '\n%s\n' "$1"; }

head2 "Health"
code=$(http "$API/api/health" /tmp/medai_health.json)
if [ "$code" = "200" ] && grep -q '"status"' /tmp/medai_health.json; then
  ok "GET /api/health → 200 $(cat /tmp/medai_health.json | head -c 120)"
else
  bad "GET /api/health → $code (expected 200)"
fi

head2 "Public endpoints"
code=$(http "$API/api/banner")
[ "$code" = "200" ] && ok "GET /api/banner → 200" || bad "GET /api/banner → $code"

code=$(http "$API/api/commercial/plans")
[ "$code" = "200" ] && ok "GET /api/commercial/plans → 200" || bad "GET /api/commercial/plans → $code (old build still live?)"

head2 "Protected endpoints (401 = route exists, 404 = old build)"
for path in /api/auth/me /api/commercial/medicine/reminders /api/commercial/biometric/status; do
  code=$(http "$API$path")
  case "$code" in
    401|403) ok "GET $path → $code (auth required, route present)" ;;
    404)     bad "GET $path → 404 (route missing — API not updated)" ;;
    *)       bad "GET $path → $code (unexpected)" ;;
  esac
done

head2 "CORS preflight (browser access from the website)"
code=$(http "$API/api/auth/login" /dev/null -X OPTIONS -H "Origin: $SITE" -H "Access-Control-Request-Method: POST")
case "$code" in
  200|204) ok "OPTIONS /api/auth/login from $SITE → $code" ;;
  *)       bad "OPTIONS /api/auth/login from $SITE → $code (check CLIENT_ORIGIN)" ;;
esac

head2 "Website"
code=$(http "$SITE/" /tmp/medai_site.html)
if [ "$code" = "200" ]; then
  ok "GET / → 200"
  if grep -q 'assets/index-' /tmp/medai_site.html; then
    ok "bundle referenced: $(grep -o 'assets/index-[^"]*' /tmp/medai_site.html | head -1)"
  else
    bad "no built bundle referenced in index.html"
  fi
else
  bad "GET / → $code"
fi

head2 "Summary"
if [ "$fails" -eq 0 ]; then
  printf '\033[32mAll checks passed.\033[0m\n'
  exit 0
fi
printf '\033[31m%s check(s) failed.\033[0m See docs/RENDER_DEPLOY_THIS_BRANCH.md\n' "$fails"
exit 1

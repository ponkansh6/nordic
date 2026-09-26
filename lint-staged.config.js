// oxfmt が変更したファイルは lint-staged が自動で再ステージするため、
// 整形差分が後追いコミットに漏れない。
export default {
  "*.{ts,tsx}": ["oxfmt --write", "vitest related --passWithNoTests"],
  // oxfmt が扱う拡張子は ts/tsx/js/jsx/mjs/cjs/mts/cts/json/md/css/yaml/yml。
  // pre-push の `oxfmt --check .` はこれら全てを検査するため、ここで書き込む
  // 範囲を検査範囲と一致させておかないと「pre-commit は通るが pre-push で
  // 落ち、しかもフックには自動修正の経路が無い」という袋小路になる
  // （実際に src/app/globals.css がこの穴に該当した）。sh / sql は oxfmt 対象外。
  "*.{js,jsx,mjs,cjs,mts,cts,json,md,css,yaml,yml}": ["oxfmt --write"],
  // 秘密情報は「コミット前」に止める。push まで待つと git 履歴に残り、
  // 修復に history rewrite が必要になる。staged のみなら高速。
  "*": ["secretlint"],
};

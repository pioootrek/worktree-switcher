# Worktree Switcher

Lokalny panel do odkrywania Git worktrees i przełączania między nimi serwerów
deweloperskich. Jeden kontroler może obsługiwać wiele niezależnych projektów,
każdy na własnym stałym porcie.

## Prototyp

Wymagania: Node.js 22+ i pnpm.

```bash
pnpm install
pnpm build
pnpm start
```

Kontroler domyślnie nasłuchuje na wszystkich interfejsach pod portem `47831`.
Przy starcie wypisuje link LAN z identyfikatorem sesji i losowym kluczem dostępu
w fragmencie URL. Identyfikator wymusza pobranie świeżego panelu po restarcie,
zamiast pozostawienia przez przeglądarkę dokumentu poprzedniej sesji.
Link należy traktować jak hasło — bez niego API, logi i zdarzenia SSE zwracają
`401`. Na hoście bez sesji graficznej kontroler nie próbuje uruchamiać
przeglądarki i pozostaje aktywny, czekając na ręczne otwarcie linku. Dane trafiają do
`$XDG_DATA_HOME/worktree-switcher/state.sqlite3` albo do
`~/.local/share/worktree-switcher/state.sqlite3`.

Panel jest dostępny po angielsku i polsku. Angielski jest językiem domyślnym,
niezależnie od ustawień przeglądarki. Przycisk `PL`/`EN` w nagłówku pozwala
zmienić język ręcznie.
Wybór jest zapisywany lokalnie w przeglądarce. Obejmuje interfejs, komunikaty
błędów zwracane przez kontroler i browser plików. Komunikaty CLI używają języka
ustawionego w `LC_ALL`, `LC_MESSAGES` lub `LANG` systemu operacyjnego.

Trwałe logi trafiają do katalogu stanu użytkownika, domyślnie
`~/.local/state/worktree-switcher/logs/`. `controller.log` zawiera operacje
kontrolera, a `projects/<id>.log` pełny zapis procesu projektu. Pliki obracają
się po osiągnięciu 5 MiB, zachowując jedną poprzednią kopię z końcówką `.1`.
To celowo nie jest `/var/log`: aplikacja działa jako zwykły użytkownik i nie
powinna wymagać uprawnień administratora. Przy późniejszej instalacji jako
usługa użytkownika systemd log kontrolera może być dodatkowo dostępny przez
`journalctl --user`.

Po dodaniu repozytorium z panelu kontroler:

- udostępnia klikalny browser katalogów ograniczony domyślnie do katalogu
  domowego użytkownika (`--browse-root` pozwala ustawić inny bezpieczny zakres);
- wykrywa worktree przez stabilny format `git worktree list --porcelain -z`;
- wykrywa menedżer pakietów i bezpiecznie uruchamia skrypt `dev` bez powłoki;
- sprawdza gotowość po HTTP i przechowuje ograniczony bufor logów;
- pozwala uruchomić, zatrzymać, zrestartować i przełączyć projekt;
- zapisuje konfigurację i wyłączne blokady w SQLite;
- zatrzymuje wyłącznie własne drzewa procesów przy zamknięciu.

Opcje kontrolera:

```bash
worktree-switcher start --port 47831 --no-open
worktree-switcher start --host 127.0.0.1
worktree-switcher start --browse-root /home/me/code
worktree-switcher start --data-dir /wybrany/katalog
worktree-switcher start --state-dir /wybrany/katalog-stanu
worktree-switcher config path
```

Jeśli host używa UFW, zezwól wyłącznie swojej podsieci LAN, zamiast otwierać
port globalnie. Przykład dla sieci `192.168.1.0/24`:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 47831 proto tcp comment 'Worktree Switcher LAN'
```

Połączenie w prototypie używa HTTP. Klucza nie należy udostępniać poza zaufaną
sieć lokalną; dostęp przez niezaufaną sieć wymaga TLS lub tunelu.

## Komenda projektu i port

Przy dodawaniu projektu Switcher czyta `package.json`, pole `packageManager`
oraz pliki blokady zależności. Obsługuje `pnpm`, `npm`, `yarn` i `bun`. Projekt
musi mieć skrypt `dev`.

Switcher nie dopisuje jednego zestawu argumentów do każdej aplikacji. Next.js
otrzymuje port w zmiennej środowiskowej `PORT`. Vite, Astro, Nuxt i Angular
dostają argument `--port` z poprawną składnią wybranego menedżera pakietów.
Pozostałe skrypty dostają `PORT`, co jest najbezpieczniejszym domyślnym
kontraktem dla własnego serwera Node.js:

```js
const port = Number(process.env.PORT ?? 3000);
server.listen(port);
```

Switcher zapisuje wykrytą komendę jako program i tablicę argumentów, a potem
uruchamia ją bez powłoki. Nie przyjmuje dowolnej komendy z panelu. W przyszłym
wydaniu konfiguracja projektu pozwoli jawnie wybrać strategię portu dla
niestandardowych frameworków i projektów innych niż Node.js.

## HTTPS serwera Next.js

Przycisk z tarczą na karcie projektu otwiera ustawienia HTTPS zarządzanego
serwera Next.js. Serwer musi być zatrzymany podczas zapisu. Dostępne są trzy
tryby:

- HTTP;
- HTTPS z lokalnym certyfikatem generowanym przez Next.js;
- HTTPS z własnym kluczem, certyfikatem i opcjonalnym plikiem CA.

Switcher używa odpowiednio `--experimental-https` oraz flag
`--experimental-https-key`, `--experimental-https-cert` i
`--experimental-https-ca`. Własne pliki wybiera się z systemu plików hosta
kontrolera. Panel zapisuje tylko ich kanoniczne ścieżki. Nie wysyła zawartości
prywatnego klucza przez HTTP.

To ustawienie szyfruje połączenie z serwerem projektu, na przykład z WinPath na
porcie `3000`. Nie włącza TLS dla panelu Worktree Switcher na porcie `47831`.
Panel nadal powinien działać wyłącznie w zaufanej sieci LAN lub przez tunel.

Flagi pochodzą z [dokumentacji CLI Next.js](https://nextjs.org/docs/app/api-reference/cli/next#using-https-during-development).

## Sprawdzenie

```bash
pnpm check
pnpm build
```

To jest funkcjonalny prototyp, nie kompletne wydanie MVP. Konfigurowalne presety
komend, agentowe dzierżawy przez MCP, zarządzanie projektami z CLI, test trzech
jednoczesnych projektów oraz instalacja jako usługa pozostają w backlogu.

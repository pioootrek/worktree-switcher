# Sidebar w kontekście wybranego projektu — 2026-09-13

## Uzgodnienia i zakres

Właściciel polecił usunąć Projects: projekt wybiera górny picker. Następnie potwierdził, że Tests i Resources mają dotyczyć wybranego projektu. Zastosowano shadcn Sidebar (Radix Nova, zgodnie z components.json) z mobilnym Sheet. Nie zmieniano kontrolera, API, danych projektów ani konfiguracji uruchamiania serwerów.

Kod roboczy: gałąź t3code/poprawki-gui, baza 1e48330. Pierwsza seria czterech poprawek została wcześniej zatwierdzona w 1e48330. Ta seria pozostaje lokalną zmianą bez commitu źródeł, scalenia i publikacji. Zapis dokumentacji na main nie wdraża GUI.

## Audyt zachowania przed zmianą

1. Projects był linkiem do #projects. Kliknięcie przewijało kartę pod nagłówek o wysokości 65 px; picker już wybierał projekt. Usunięto duplikat.
2. Tests i Resources były elementami span bez zdarzeń i bez dostępu przez Tab. Rzeczywiste kliknięcia nie zmieniały widoku. Wewnętrzna zakładka Tests działała. Podłączono istniejące panele projektu do wspólnej nawigacji.
3. Settings był nieaktywnym div. Przy 25 worktree WinPath znajdował się około y=2905 px. Usunięto martwą pozycję; działające ustawienia środowiska i HTTPS nadal są w nagłówku karty.
4. Sidebar rósł razem z dokumentem (WinPath około 2994 px), a menu znikało przy przewijaniu. Nowy panel ma wysokość viewportu, stały nagłówek i stopkę oraz przewijaną zawartość.
5. Brakowało prawdziwego stanu aktywnego. Teraz aktywny przycisk ma wyróżnienie i aria-current=page; wszystkie pozycje są dostępne klawiaturą.
6. Przy zmierzonym mobilnym viewportcie 427×925 sidebar znikał i nie miał zastępstwa. Dodano przycisk otwierający Sheet, zamknięcie przy wyborze, Escape i przywracanie fokusu.
7. Potwierdzono istniejący GUI-08: po wyszukaniu i wybraniu WinPath ponowne otwarcie pickera zachowywało filtr. To pozostaje poza tą poprawką.

## Zaimplementowane zachowanie

- Worktrees: tabela gałęzi oraz istniejący status projektu.
- Tests: istniejące presety, profile i historia testów wybranego projektu.
- Resources: istniejące metryki uruchomionego serwera i panel dysku projektu. Panel dysku zachowuje swój własny wybór worktree i dotychczasowy domyślny cel.
- Logs: logi serwera wybranego projektu.
- Zmiana sekcji zachowuje wybrany cel operacji w ProjectCard. Zmiana projektu pozostawia bieżącą sekcję, a odtwarza stan celu z nowego projektu.
- Widoki Tests/Resources/Logs nie renderują długiej tabeli worktree. Wybór celu i istniejące przyciski serwera pozostają dostępne.
- Picker pozostaje w górnym nagłówku. Usunięto zduplikowane dolne zakładki oraz Projects i martwe Settings w menu.
- Zachowano pojedynczy useDashboard, subskrypcję SSE, klucze paneli zależne od worktree, istniejące mutacje i PL/EN.
- Źródła shadcn pobrano przez lokalne shadcn view. Dodano tylko cztery nowe pliki zależności komponentu; nie nadpisywano Button/Input/Tooltip/Separator i nie dodawano pakietów. Zastąpiono placeholdery ikon Lucide i cn lokalnym helperem. Hook media query używa useSyncExternalStore; etykiety Sheet są przekazywane z i18n.

## Weryfikacja i ograniczenia

Wbudowana karta tab_a miała uwierzytelnioną sesję; API dashboard zwracało 200. Kliknięto rzeczywiste pozycje przed i po zmianie, picker, przełącznik zwinięcia i Escape. Po przejściu z WinPath do Prosty Prawnik widok Logs pozostał aktywny, a karta odpowiadała nowemu projektowi. Na desktopie po przewinięciu sidebar pozostał od y=0 do y=973, a nagłówek od y=0 do y=65. Tryb zwinięty ma szerokość 48 px; rozwinięty 256 px.

Preview snapshot nadal kończył się błędem. Wymiary tej przeglądarki potrafiły zmieniać się między wywołaniami (977/1709 px i mobilnie 427 px), więc nie traktowano żądanego rozmiaru jako wyniku pomiaru. Screenshoty dołączone do tej serii pochodzą z testów fixture, nie z żywego kontrolera. Sprawdzono ich wygląd.

Pierwszy test mobilny wykrył, że tooltip niewidoczny na telefonie przechwytywał Escape. Poprawka renderuje tooltipy tylko w zwiniętym sidebarze desktopowym. Początkowy check wykrył również niezgodny z lintem hook shadcn; zastąpiono go subskrypcją media query. Końcowe wyniki i identyfikatory kolejkowanych weryfikacji są w sidebar-verification.json.

Kolejka może pokazywać failed mimo kodu 0 z powodu dirty_source: zmiany i lokalne pliki HMR nie są czystym commitem. Sukces komendy nie jest potwierdzeniem źródła dla SHA.

## Pozostała praca

GUI-06 i GUI-22 obejmuje ta poprawka. GUI-07 jest rozwiązane częściowo: osobne widoki nie są pod tabelą, ale w Worktrees nadal brakuje filtrowania i ograniczenia wysokości tabeli, a główne działania są pod listą. Nie zamykamy całego audytu ani GUI-08. Dalsze porządkowanie górnego nagłówka, wybór celu dla panelu dysku i deduplikacja informacji pozostają osobnymi decyzjami.

## Odtworzenie i revert

sidebar-gui.patch.txt zawiera wyłącznie źródła GUI i dostosowane testy, bez package.json, next.config.ts, tokenów i lokalnego proxy. Patch jest względem 1e48330; przed zastosowaniem należy sprawdzić zgodność bazy. Odtworzenie: git apply --check --unidiff-zero, potem git apply --unidiff-zero. Revert tej serii: sprawdzenie i odwrotne zastosowanie tego samego patcha z -R --unidiff-zero. Nie cofa to wcześniejszej serii ani lokalnej konfiguracji HMR.

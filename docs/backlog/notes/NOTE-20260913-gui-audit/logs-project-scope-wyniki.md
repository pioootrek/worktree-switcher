# Logs: jeden picker projektów

Data: 2026-09-13. Zastępuje układ źródeł opisany w logs-wyniki.md.

Po uwadze właściciela usunięto boczny panel Log sources, który powielał górny picker. Wybrany projekt pokazuje jedną konsolę pełnej szerokości. All projects pokazuje osobną konsolę każdego projektu, z nazwą, stanem i gałęzią. shadcn Collapsible na zainstalowanym Radix pozwala zwijać panele. Działające serwery startują rozwinięte, zatrzymane zwinięte. Pojedynczy projekt zawsze ma widoczną konsolę.

Wyszukiwarka nad panelami przekazuje wspólną frazę do wszystkich konsol. Wpisanie frazy otwiera panele, a każdy pokazuje własne trafienia i nawigację. Wyszukiwanie zamraża bufory do czytania; przewijanie, pauza, kopiowanie i eksport pozostają osobne. Wznowienie śledzenia czyści wspólną frazę. Nie łączymy źródeł w pozorną chronologiczną oś. Limit API nadal wynosi do 400 wpisów danego uruchomienia.

## Weryfikacja

- Build (w tym TypeScript): kod 0.
- UI: 40/40; zaktualizowane scenariusze Logs przy 390/1440 px sprawdzają oba projekty, wspólne trafienia, rozwijanie przez wyszukiwanie, zwijanie i klawiaturę, eksport oraz powrót do pojedynczego projektu. Test przesuwającego się bufora nadal przechodzi.
- Lint: kod 0; istniejące ostrzeżenie nieużywanej zmiennej b w niezwiązanym managed-test-queue.spec.ts.
- Wszystkie trzy zadania kolejki mają processOutcome=passed, exitCode=0; phase=failed wynika z dirty_source. Brak poświadczenia czystego commitu.
- W istniejącej tab_a potwierdzono trzy panele po 1389 px bez bocznego pickera i przepełnienia; następnie pojedynczą konsolę Worktree Switchera i wyszukiwanie Error (24 trafienia). PNG przedstawia fixture Playwright, nie rzeczywiste dane. Mobilny test przeszedł; pełny zrzut z przewiniętej strony ma artefakt pozycji sticky header, więc nie dołączono go jako dowodu wizualnego.
- Bez restartu kontrolera lub serwerów. Jedna istniejąca subskrypcja dashboardu. Nie uruchamiano ponownie testów backendu, który nie zmienił się w tej korekcie.

## Cofnięcie

logs-project-scope.patch.txt zawiera tylko tę korektę ponad poprzedni stan Logs. Sprawdzono git apply --reverse --check. Cofnięcie: najpierw --check, następnie git apply --reverse ze ścieżką do patcha. Dla cofnięcia całego Logs należy odwrócić najpierw ten patch, potem logs.patch.txt. Źródła pozostają robocze, bez commitu GUI, push i merge. Lokalne ustawienia dev i niezwiązane zmiany są poza patchem.

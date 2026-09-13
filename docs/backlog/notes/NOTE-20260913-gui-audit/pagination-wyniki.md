# Wyszukiwanie i paginacja worktree — 2026-09-13

Na polecenie właściciela lista worktree ma wyszukiwanie po gałęzi, ścieżce i pełnym commicie (także jego prefiksie). Wielkość liter i skrajne spacje nie wpływają na wyniki. Strona zawiera maksymalnie 10 rekordów; poniżej są przyciski Poprzednia/Następna, numer strony i licznik wyników względem całej listy.

Wpisanie frazy wraca na pierwszą stronę. Zmniejszenie zbioru po odświeżeniu ogranicza numer strony do dostępnego zakresu. Pusty wynik pokazuje komunikat i wyłącza oba przyciski. Filtrowanie oraz stronicowanie nie zmieniają wybranego celu, stanu serwera ani danych projektu. Selektor celu pod tabelą nadal zawiera wszystkie worktree. Stan wyszukiwania i strony jest lokalny dla karty wybranego projektu; zmiana sekcji go zachowuje, a zmiana projektu odtwarza.

Użyto istniejących shadcn Input, Label i Button oraz semantycznej nawigacji paginacji. Dodano tłumaczenia PL/EN. Nie dodano zależności ani operacji kontrolera.

W uwierzytelnionej, istniejącej karcie tab_a sprawdzono WinPath: 25 rekordów, 10 na pierwszej stronie, 10 na drugiej, wyszukanie storage-reliability daje jeden rekord, brak dopasowania daje komunikat oraz nieaktywne przyciski. Wybrany cel pozostał niezmieniony we wszystkich krokach. Na koniec wyczyszczono filtr, przywrócono pierwszą stronę i pozostawiono WinPath w przeglądarce.

Dwa nowe testy UI (390 i 1440 px) sprawdzają wszystkie trzy strony, wyszukiwanie po gałęzi bez rozróżnienia wielkości liter, ścieżce i commicie, pusty wynik, reset strony, zachowanie celu po wybraniu ostatniego rekordu oraz brak mutacji API. Screenshoty są z fixture; bez tokenów. Wyniki komend kolejkowanych są w pagination-verification.json. Dirty source oznacza brak potwierdzenia dla czystego SHA nawet przy kodzie wyjścia 0.

To uzupełnia GUI-07 o filtr i stronicowanie. Główne akcje w widoku Worktrees nadal znajdują się pod tabelą, teraz ograniczoną do 10 wierszy. Nie zmieniano dotychczasowego zachowania pickera projektów (GUI-08).

Zmiany źródeł pozostają lokalne, bez nowego commitu i bez publikacji. pagination-gui.patch.txt jest przyrostem względem poprzedniej serii sidebar, a nie względem HEAD. Cofnięcie tylko tej serii: git apply --check -R --unidiff-zero pagination-gui.patch.txt, następnie git apply -R --unidiff-zero pagination-gui.patch.txt. Nie cofa wcześniejszego sidebaru ani lokalnej konfiguracji HMR. Sprawdzono poprawność odwrotnego patcha.

# PR 40 — review follow-up

2026-09-13. PR: https://github.com/pioootrek/worktree-switcher/pull/40
Commit źródeł: `4fa8b13c5e7c04e06a8d26dc3ed859a9269225af` (wypchnięty).

Wynik: 5 fix, 0 backlog, 0 false positive. Odpowiedziano w pięciu oryginalnych wątkach i zamknięto je po weryfikacji. Ponowne pobranie wszystkich stron: 0 nierozwiązanych wątków.

- Opcjonalny zapis historii uruchomień nie zmienia wyniku udanego start/restart/switch, również dla lokalnego użytkownika. Błąd zapisu daje ograniczony diagnostyczny wpis.
- Uruchomienia MCP zachowują zanonimizowany identyfikator aktora.
- SQLite filtruje historię projektu i typ zdarzenia przed limitem; migracja 16 dodaje indeks częściowy. Regresja obejmuje ponad 2000 obcych zdarzeń oraz ponowne otwarcie bazy.
- Dashboard Tests udostępnia całą przechowywaną historię (50 zakończonych prób na projekt) i aktywną kolejkę. Limit projekcji 200 pokrywa 50 zakończonych + 100 oczekujących + 16 aktywnych. Nie przywraca usuniętych prób. Flaga testHistoryComplete pozwala zachować uczciwy opis limitu 20 na starym kontrolerze.
- Trzy scenariusze E2E dostosowano do akcji w wierszach oraz nowego dashboardu Tests.

Weryfikacja, sekwencyjnie przez kolejkę Worktree Switcher:

| Preset | Run ID | Wynik |
| --- | --- | --- |
| check | c6834ed0-d8e7-4782-a82a-bc6580544bc7 | exit 0; 316 Vitest + 7 resources, lint/typecheck |
| build | 24f6ca1d-9b26-42a7-94f7-374f54e31afd | exit 0 |
| test:e2e | ac1c5cce-4d80-45d9-a6c8-cc18e5ddd731 | exit 0; 3/3 |
| test:ui | f36edc2e-b2fd-4b27-99f1-0616297a0ad9 | exit 0; 40/40 |

Testy wykonano na stabilnym, niezatwierdzonym drzewie przed commitem; status źródeł dirty_source nie stanowi atestacji czystego commitu. Git diff --check przeszedł. Poprzedni check z niekompletną konfiguracją fixture oraz odrzucony przed startem build nie są liczone jako sukcesy.

W istniejącej karcie tab_a sprawdzono Tests po HMR i brak poziomego overflow. Działający kontroler nie został zrestartowany: nadal pokazuje opis starszego limitu. Nowy backend zweryfikowano na rzeczywistym SQLite oraz izolowanych fixture E2E. Lokalne next.config.ts, package.json i artifacts/ pozostają poza commitem.

CI check-build dla nowego commitu było IN_PROGRESS podczas zapisu (run 34772152452). PR nadal draft, bez scalenia i bez kolejnego zlecenia n8n. Ten raport zapisano lokalnie na main, bez push main.

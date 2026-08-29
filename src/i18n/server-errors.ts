import type { Locale } from "./messages";

const exactEnglish = new Map<string, string>([
  ["Nazwa projektu jest wymagana.", "Project name is required."],
  ["Port musi być liczbą od 1024 do 65535.", "Port must be an integer between 1024 and 65535."],
  ["Repozytorium nie ma dostępnego worktree.", "The repository has no available worktree."],
  ["Zatrzymaj serwer przed zmianą ustawień HTTPS.", "Stop the server before changing HTTPS settings."],
  ["Worktree nie należy do zarejestrowanego repozytorium lub już nie istnieje.", "The worktree does not belong to this repository or no longer exists."],
  ["Nie można uruchomić uszkodzonego worktree oznaczonego jako prunable.", "A damaged worktree marked as prunable cannot be started."],
  ["Nie znaleziono projektu.", "Project not found."],
  ["Serwer projektu już działa.", "The project server is already running."],
  ["Wybrana ścieżka nie jest repozytorium Git.", "The selected path is not a Git repository."],
  ["Nie znaleziono package.json. Automatyczna konfiguracja obsługuje obecnie projekty Node.js.", "package.json was not found. Automatic configuration currently supports Node.js projects."],
  ["Nie udało się odczytać package.json. Sprawdź, czy plik zawiera prawidłowy JSON.", "package.json could not be read. Check that it contains valid JSON."],
  ["Projekt nie ma skryptu dev w package.json.", "The project has no dev script in package.json."],
  ["HTTPS zarządzany przez Switcher jest obecnie obsługiwany tylko dla Next.js.", "Switcher-managed HTTPS currently supports Next.js only."],
  ["Nie można przeglądać katalogów poza dozwolonym katalogiem głównym.", "Directories outside the configured browser root cannot be accessed."],
  ["Brak uprawnień do odczytu tego katalogu.", "You do not have permission to read this directory."],
  ["Nie udało się odczytać katalogu.", "The directory could not be read."],
  ["Dzierżawa agenta musi trwać co najmniej 30 sekund.", "An agent lease must last at least 30 seconds."],
  ["Tylko właściciel może zdjąć tę blokadę.", "Only the owner can release this lock."],
  ["Żądanie zawiera nieobsługiwane pole.", "The request contains an unsupported field."],
  ["Nieprawidłowe pole port.", "Invalid port field."],
  ["Nieprawidłowa operacja.", "Invalid operation."],
  ["Nieprawidłowy tryb HTTPS.", "Invalid HTTPS mode."],
  ["Nieprawidłowa operacja blokady.", "Invalid lock operation."],
  ["Żądanie jest zbyt duże.", "The request is too large."],
  ["Nieprawidłowy JSON.", "Invalid JSON."],
  ["Brak prawidłowego klucza dostępu.", "A valid access token is required."],
  ["Odrzucono żądanie z obcego originu.", "The request origin was rejected."],
  ["Wybierz worktree do zablokowania.", "Select a worktree to lock."],
  ["Maksymalny czas dzierżawy nie może być krótszy od jej czasu początkowego.", "The maximum lease lifetime cannot be shorter than its initial TTL."],
  ["Dzierżawa agenta wymaga tokenu i klucza idempotencji.", "An agent lease requires a token and an idempotency key."],
  ["Klucz idempotencji jest już używany przez inną dzierżawę.", "The idempotency key is already used by another lease."],
  ["Dzierżawa agenta wygasła lub nie istnieje.", "The agent lease expired or does not exist."],
  ["Nieprawidłowy token dzierżawy agenta.", "The agent lease token is invalid."],
  ["Dzierżawa agenta osiągnęła maksymalny czas życia.", "The agent lease reached its maximum lifetime."],
  ["Dzierżawę agenta może zdjąć tylko jej właściciel lub człowiek przez force release.", "Only the owning agent or an explicit human force release can release this lease."],
  ["Oczekiwano obiektu JSON.", "A JSON object is required."],
  ["Nie znaleziono endpointu.", "Endpoint not found."],
  ["Proces zakończył się podczas startu.", "The process exited during startup."],
  ["Na tym porcie działa inny serwer. Worktree Switcher pozostawił go bez zmian.", "Another server is using this port. Worktree Switcher left it unchanged."],
  ["Kontroler nie może uruchomić skonfigurowanej komendy.", "The controller cannot run the configured command."],
  ["Limit serwerów musi być liczbą całkowitą od 1 do 64.", "The server limit must be an integer from 1 to 64."],
  ["System odrzucił próbę uruchomienia serwera deweloperskiego.", "The operating system rejected the development server launch."],
  ["W pliku package.json nie znaleziono skryptu potrzebnego do uruchomienia serwera.", "No development server script was found in package.json."],
  ["Komenda deweloperska odrzuciła argument z numerem portu.", "The development command rejected the port argument."],
  ["Serwer prawdopodobnie przekroczył dostępny limit pamięci lub został przymusowo zakończony.", "The server probably exceeded its memory limit or was forcibly terminated."],
  ["Komenda deweloperska zakończyła się, zanim aplikacja zgłosiła gotowość.", "The development command exited before the application became ready."],
]);

const fileLabels = new Map<string, string>([
  ["klucz prywatny", "private key"],
  ["certyfikat", "certificate"],
  ["CA", "CA"],
]);

export function localizeServerMessage(message: string, locale: Locale): string {
  if (locale === "pl") return message;
  const exact = exactEnglish.get(message);
  if (exact) return exact;

  let match = message.match(/^Nieprawidłowe pole (.+)\.$/);
  if (match) return `Invalid ${match[1]} field.`;
  match = message.match(/^Wskaż plik: (.+)\.$/);
  if (match) return `Select the ${fileLabels.get(match[1]) ?? match[1]} file.`;
  match = message.match(/^Nie można odczytać pliku (.+): (.+)$/);
  if (match) return `Cannot read the ${fileLabels.get(match[1]) ?? match[1]} file: ${match[2]}`;
  match = message.match(/^Projekt jest zablokowany przez (.+)\.$/);
  if (match) return `The project is locked by ${match[1]}.`;
  match = message.match(/^Projekt jest zablokowany na (.+) przez (.+)\.$/);
  if (match) return `The project is locked to ${match[1]} by ${match[2]}.`;
  match = message.match(/^Osiągnięto limit (\d+) uruchomionych serwerów\. Aktywne: (.+)\.$/);
  if (match) return `The limit of ${match[1]} running servers has been reached. Active: ${match[2]}.`;
  match = message.match(/^Proces działał, ale nie odpowiedział na porcie (\d+) w ciągu (.+) sekund\.$/);
  if (match) return `The process did not respond on port ${match[1]} within ${match[2]} seconds.`;
  return message;
}

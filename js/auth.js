import {
  ensureArtistForCognito,
  ensureUserForCognito,
  getArtistById,
  getDB,
  getArtistPublishSummary,
  hydratePrivateDB,
  hydrateDB,
  markNotificationsRead,
  sendMessage,
  toggleSaveArtist,
  updateBookingStatus,
  getUserById,
  updateArtistProfile,
  updateUserPreferences,
  updateUserProfile,
  updateUserSetup,
  completeUserSetup,
} from "./store.js";
import {
  confirmForgotPasswordCognito,
  confirmSignUpCognito,
  ensureCognitoSession,
  forgotPasswordCognito,
  isCognitoAuthenticated,
  signInCognito,
  signOutCognito,
  signUpCognito,
} from "./cognito-auth.js";
import { clearCognitoIdentity, getSession, setCognitoIdentity, setSession } from "./session.js";
import { initSharedPage } from "./shared-nav.js";
import { byId, showToast } from "./utils.js";

initSharedPage();
await hydrateDB();

// ---------------------------------------------------------------------------
// Location: country + city dropdowns
// ---------------------------------------------------------------------------

const CITIES_BY_COUNTRY = {
  "Australia": ["New South Wales", "Victoria", "Queensland", "Western Australia", "South Australia", "Tasmania", "ACT", "Northern Territory"],
  "New Zealand": ["Auckland", "Wellington", "Canterbury", "Waikato", "Otago", "Bay of Plenty", "Hawke's Bay", "Manawatu-Whanganui"],
  "United States": ["Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia", "Wisconsin", "Wyoming"],
  "United Kingdom": ["England", "Scotland", "Wales", "Northern Ireland"],
  "Canada": ["Alberta", "British Columbia", "Manitoba", "New Brunswick", "Newfoundland and Labrador", "Nova Scotia", "Ontario", "Prince Edward Island", "Quebec", "Saskatchewan"],
  "Ireland": ["Connacht", "Leinster", "Munster", "Ulster"],
  "South Africa": ["Eastern Cape", "Free State", "Gauteng", "KwaZulu-Natal", "Limpopo", "Mpumalanga", "North West", "Northern Cape", "Western Cape"],
  "India": ["Andhra Pradesh", "Assam", "Bihar", "Delhi", "Gujarat", "Haryana", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Odisha", "Punjab", "Rajasthan", "Tamil Nadu", "Telangana", "Uttar Pradesh", "West Bengal"],
  "Philippines": ["Luzon", "Visayas", "Mindanao", "Metro Manila", "Calabarzon", "Central Luzon", "Central Visayas", "Davao Region"],
  "Singapore": ["Central Region", "East Region", "North Region", "North-East Region", "West Region"],
  "Japan": ["Hokkaido", "Tohoku", "Kanto", "Chubu", "Kansai", "Chugoku", "Shikoku", "Kyushu", "Okinawa"],
  "South Korea": ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju", "Gyeonggi", "Gangwon", "Chungbuk", "Chungnam", "Jeonbuk", "Jeonnam", "Gyeongbuk", "Gyeongnam", "Jeju"],
  "China": ["Beijing", "Shanghai", "Guangdong", "Sichuan", "Zhejiang", "Jiangsu", "Shandong", "Hubei", "Hunan", "Fujian", "Shaanxi", "Chongqing", "Yunnan", "Henan", "Liaoning"],
  "Germany": ["Baden-Württemberg", "Bavaria", "Berlin", "Brandenburg", "Bremen", "Hamburg", "Hesse", "Lower Saxony", "Mecklenburg-Vorpommern", "North Rhine-Westphalia", "Rhineland-Palatinate", "Saarland", "Saxony", "Saxony-Anhalt", "Schleswig-Holstein", "Thuringia"],
  "France": ["Auvergne-Rhône-Alpes", "Bourgogne-Franche-Comté", "Brittany", "Centre-Val de Loire", "Corsica", "Grand Est", "Hauts-de-France", "Île-de-France", "Normandy", "Nouvelle-Aquitaine", "Occitanie", "Pays de la Loire", "Provence-Alpes-Côte d'Azur"],
  "Italy": ["Abruzzo", "Basilicata", "Calabria", "Campania", "Emilia-Romagna", "Friuli-Venezia Giulia", "Lazio", "Liguria", "Lombardy", "Marche", "Molise", "Piedmont", "Puglia", "Sardinia", "Sicily", "Tuscany", "Trentino-Alto Adige", "Umbria", "Valle d'Aosta", "Veneto"],
  "Spain": ["Andalusia", "Aragon", "Asturias", "Balearic Islands", "Basque Country", "Canary Islands", "Cantabria", "Castile and León", "Castile-La Mancha", "Catalonia", "Extremadura", "Galicia", "La Rioja", "Madrid", "Murcia", "Navarre", "Valencia"],
  "Netherlands": ["Drenthe", "Flevoland", "Friesland", "Gelderland", "Groningen", "Limburg", "North Brabant", "North Holland", "Overijssel", "South Holland", "Utrecht", "Zeeland"],
  "Sweden": ["Blekinge", "Dalarna", "Gävleborg", "Gotland", "Halland", "Jämtland", "Jönköping", "Kalmar", "Kronoberg", "Norrbotten", "Örebro", "Östergötland", "Skåne", "Södermanland", "Stockholm", "Uppsala", "Värmland", "Västerbotten", "Västernorrland", "Västmanland", "Västra Götaland"],
  "Norway": ["Agder", "Innlandet", "Møre og Romsdal", "Nordland", "Oslo", "Rogaland", "Troms og Finnmark", "Trøndelag", "Vestfold og Telemark", "Vestland", "Viken"],
  "Denmark": ["Capital Region", "Central Denmark", "North Denmark", "Region Zealand", "Southern Denmark"],
  "Finland": ["Lapland", "North Ostrobothnia", "North Savo", "Pirkanmaa", "South Karelia", "Southwest Finland", "Uusimaa"],
  "Brazil": ["Acre", "Alagoas", "Amapá", "Amazonas", "Bahia", "Ceará", "Distrito Federal", "Espírito Santo", "Goiás", "Maranhão", "Mato Grosso", "Mato Grosso do Sul", "Minas Gerais", "Pará", "Paraíba", "Paraná", "Pernambuco", "Piauí", "Rio de Janeiro", "Rio Grande do Norte", "Rio Grande do Sul", "Rondônia", "Roraima", "Santa Catarina", "São Paulo", "Sergipe", "Tocantins"],
  "Mexico": ["Aguascalientes", "Baja California", "Baja California Sur", "Campeche", "Chiapas", "Chihuahua", "Coahuila", "Colima", "Durango", "Guanajuato", "Guerrero", "Hidalgo", "Jalisco", "Mexico City", "Mexico State", "Michoacán", "Morelos", "Nayarit", "Nuevo León", "Oaxaca", "Puebla", "Querétaro", "Quintana Roo", "San Luis Potosí", "Sinaloa", "Sonora", "Tabasco", "Tamaulipas", "Tlaxcala", "Veracruz", "Yucatán", "Zacatecas"],
  "Argentina": ["Buenos Aires", "Catamarca", "Chaco", "Chubut", "Córdoba", "Corrientes", "Entre Ríos", "Formosa", "Jujuy", "La Pampa", "La Rioja", "Mendoza", "Misiones", "Neuquén", "Río Negro", "Salta", "San Juan", "San Luis", "Santa Cruz", "Santa Fe", "Santiago del Estero", "Tierra del Fuego", "Tucumán"],
  "Colombia": ["Amazonas", "Antioquia", "Arauca", "Atlántico", "Bolívar", "Boyacá", "Caldas", "Caquetá", "Casanare", "Cauca", "Cesar", "Chocó", "Córdoba", "Cundinamarca", "Guainía", "Guaviare", "Huila", "La Guajira", "Magdalena", "Meta", "Nariño", "Norte de Santander", "Putumayo", "Quindío", "Risaralda", "San Andrés", "Santander", "Sucre", "Tolima", "Valle del Cauca", "Vaupés", "Vichada"],
  "Chile": ["Arica y Parinacota", "Tarapacá", "Antofagasta", "Atacama", "Coquimbo", "Valparaíso", "Metropolitan", "O'Higgins", "Maule", "Ñuble", "Biobío", "La Araucanía", "Los Ríos", "Los Lagos", "Aysén", "Magallanes"],
  "Indonesia": ["Aceh", "Bali", "Banten", "Bengkulu", "Central Java", "Central Kalimantan", "Central Sulawesi", "East Java", "East Kalimantan", "East Nusa Tenggara", "Gorontalo", "Jakarta", "Jambi", "Lampung", "Maluku", "North Kalimantan", "North Maluku", "North Sulawesi", "North Sumatra", "Papua", "Riau", "Riau Islands", "South Kalimantan", "South Sulawesi", "South Sumatra", "Southeast Sulawesi", "West Java", "West Kalimantan", "West Nusa Tenggara", "West Papua", "West Sulawesi", "West Sumatra", "Yogyakarta"],
  "Thailand": ["Bangkok", "Central Thailand", "Eastern Thailand", "Northern Thailand", "Northeastern Thailand", "Southern Thailand", "Western Thailand"],
  "Vietnam": ["North Vietnam", "Central Vietnam", "South Vietnam", "Hanoi", "Ho Chi Minh City", "Da Nang"],
  "Malaysia": ["Johor", "Kedah", "Kelantan", "Kuala Lumpur", "Labuan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Putrajaya", "Sabah", "Sarawak", "Selangor", "Terengganu"],
  "United Arab Emirates": ["Abu Dhabi", "Ajman", "Dubai", "Fujairah", "Ras Al Khaimah", "Sharjah", "Umm Al Quwain"],
  "Saudi Arabia": ["Riyadh", "Makkah", "Madinah", "Eastern Province", "Asir", "Tabuk", "Hail", "Northern Borders", "Jazan", "Najran", "Al Bahah", "Al Jawf", "Qassim"],
  "Israel": ["Central District", "Haifa District", "Jerusalem District", "Northern District", "Southern District", "Tel Aviv District"],
  "Egypt": ["Alexandria", "Aswan", "Asyut", "Beheira", "Beni Suef", "Cairo", "Dakahlia", "Damietta", "Faiyum", "Gharbia", "Giza", "Ismailia", "Kafr el-Sheikh", "Luxor", "Matruh", "Minya", "Monufia", "New Valley", "North Sinai", "Port Said", "Qalyubia", "Qena", "Red Sea", "Sharqia", "Sohag", "South Sinai", "Suez"],
  "Nigeria": ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"],
  "Kenya": ["Central", "Coast", "Eastern", "Nairobi", "North Eastern", "Nyanza", "Rift Valley", "Western"],
  "Poland": ["Greater Poland", "Kuyavian-Pomeranian", "Lesser Poland", "Łódź", "Lower Silesian", "Lublin", "Lubusz", "Masovian", "Opole", "Podlaskie", "Pomeranian", "Silesian", "Subcarpathian", "Świętokrzyskie", "Warmian-Masurian", "West Pomeranian"],
  "Portugal": ["Alentejo", "Algarve", "Azores", "Centro", "Lisbon", "Madeira", "Norte"],
  "Switzerland": ["Aargau", "Appenzell Ausserrhoden", "Appenzell Innerrhoden", "Basel-Landschaft", "Basel-Stadt", "Bern", "Fribourg", "Geneva", "Glarus", "Graubünden", "Jura", "Lucerne", "Neuchâtel", "Nidwalden", "Obwalden", "Schaffhausen", "Schwyz", "Solothurn", "St. Gallen", "Thurgau", "Ticino", "Uri", "Valais", "Vaud", "Zug", "Zurich"],
  "Austria": ["Burgenland", "Carinthia", "Lower Austria", "Salzburg", "Styria", "Tyrol", "Upper Austria", "Vienna", "Vorarlberg"],
  "Belgium": ["Brussels", "Flanders", "Wallonia"],
  "Czech Republic": ["Bohemia", "Moravia", "Silesia"],
  "Romania": ["Alba", "Arad", "Argeș", "Bacău", "Bihor", "Bistrița-Năsăud", "Botoșani", "Brăila", "Brașov", "Bucharest", "Buzău", "Călărași", "Cluj", "Constanța", "Covasna", "Dâmbovița", "Dolj", "Galați", "Giurgiu", "Gorj", "Harghita", "Hunedoara", "Ialomița", "Iași", "Ilfov", "Maramureș", "Mehedinți", "Mureș", "Neamț", "Olt", "Prahova", "Sălaj", "Satu Mare", "Sibiu", "Suceava", "Teleorman", "Timiș", "Tulcea", "Vâlcea", "Vaslui", "Vrancea"],
  "Greece": ["Attica", "Central Greece", "Central Macedonia", "Crete", "Eastern Macedonia and Thrace", "Epirus", "Ionian Islands", "North Aegean", "Peloponnese", "South Aegean", "Thessaly", "Western Greece", "Western Macedonia"],
  "Turkey": ["Adana", "Ankara", "Antalya", "Bursa", "Diyarbakır", "Erzurum", "Gaziantep", "İstanbul", "İzmir", "Kayseri", "Konya", "Mersin", "Samsun", "Trabzon"],
  "Russia": ["Central Federal District", "Far Eastern Federal District", "North Caucasian Federal District", "Northwestern Federal District", "Siberian Federal District", "Southern Federal District", "Ural Federal District", "Volga Federal District"],
  "Ukraine": ["Cherkasy", "Chernihiv", "Chernivtsi", "Dnipropetrovsk", "Donetsk", "Ivano-Frankivsk", "Kharkiv", "Kherson", "Khmelnytskyi", "Kirovohrad", "Kyiv", "Luhansk", "Lviv", "Mykolaiv", "Odesa", "Poltava", "Rivne", "Sumy", "Ternopil", "Vinnytsia", "Volyn", "Zakarpattia", "Zaporizhzhia", "Zhytomyr"],
  "Pakistan": ["Azad Kashmir", "Balochistan", "Gilgit-Baltistan", "Islamabad Capital Territory", "Khyber Pakhtunkhwa", "Punjab", "Sindh"],
  "Bangladesh": ["Barisal", "Chittagong", "Dhaka", "Khulna", "Mymensingh", "Rajshahi", "Rangpur", "Sylhet"],
  "Taiwan": ["Changhua", "Chiayi", "Hsinchu", "Hualien", "Kaohsiung", "Keelung", "Miaoli", "Nantou", "New Taipei", "Penghu", "Pingtung", "Taichung", "Tainan", "Taipei", "Taitung", "Taoyuan", "Yilan", "Yunlin"],
  "Hong Kong": ["Central and Western", "Eastern", "Islands", "Kowloon City", "Kwai Tsing", "Kwun Tong", "North", "Sai Kung", "Sha Tin", "Sham Shui Po", "Southern", "Tai Po", "Tsuen Wan", "Tuen Mun", "Wan Chai", "Wong Tai Sin", "Yau Tsim Mong", "Yuen Long"],
};

const COUNTRIES = Object.keys(CITIES_BY_COUNTRY);

function populateCountrySelect(selectEl) {
  if (!selectEl) return;
  selectEl.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Select country";
  selectEl.appendChild(blank);
  for (const c of COUNTRIES) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    selectEl.appendChild(opt);
  }
  const other = document.createElement("option");
  other.value = "__other__";
  other.textContent = "Other…";
  selectEl.appendChild(other);
}

function populateCitySelect(citySelectEl, cityOtherEl, country) {
  if (!citySelectEl) return;
  citySelectEl.innerHTML = "";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = country ? "Select city" : "Select country first";
  citySelectEl.appendChild(blank);
  const cities = CITIES_BY_COUNTRY[country] || [];
  for (const c of cities) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    citySelectEl.appendChild(opt);
  }
  const other = document.createElement("option");
  other.value = "__other__";
  other.textContent = "Other city…";
  citySelectEl.appendChild(other);
  if (cityOtherEl) cityOtherEl.hidden = true;
}

function onCitySelectChange(citySelectEl, cityOtherEl) {
  if (!citySelectEl || !cityOtherEl) return;
  const isOther = citySelectEl.value === "__other__";
  cityOtherEl.hidden = !isOther;
  if (isOther) {
    cityOtherEl.value = "";
    cityOtherEl.focus();
  }
}

function parseLocation(location) {
  const raw = String(location || "").trim();
  if (!raw) return { city: "", country: "" };
  const lastComma = raw.lastIndexOf(",");
  if (lastComma === -1) return { city: raw, country: "" };
  return { city: raw.slice(0, lastComma).trim(), country: raw.slice(lastComma + 1).trim() };
}

function setLocationFields(countryEl, citySelectEl, cityOtherEl, location) {
  const { city, country } = parseLocation(location);
  const knownCountry = COUNTRIES.includes(country) ? country : "";
  if (countryEl) countryEl.value = knownCountry || (country ? "__other__" : "");
  populateCitySelect(citySelectEl, cityOtherEl, knownCountry);
  if (citySelectEl) {
    const knownCity = (CITIES_BY_COUNTRY[knownCountry] || []).includes(city) ? city : (city ? "__other__" : "");
    citySelectEl.value = knownCity;
    if (knownCity === "__other__" && cityOtherEl) {
      cityOtherEl.hidden = false;
      cityOtherEl.value = city;
    }
  }
}

function getCityFromFields(citySelectEl, cityOtherEl) {
  if (!citySelectEl) return "";
  if (citySelectEl.value === "__other__") return (cityOtherEl?.value || "").trim();
  return citySelectEl.value === "" ? "" : citySelectEl.value;
}

function getLocationFromFields(countryEl, citySelectEl, cityOtherEl) {
  const country = (!countryEl || countryEl.value === "__other__" || countryEl.value === "") ? "" : countryEl.value;
  const city = getCityFromFields(citySelectEl, cityOtherEl);
  if (city && country) return `${city}, ${country}`;
  if (country) return country;
  return city;
}

function wireLocationSelects(countryEl, citySelectEl, cityOtherEl) {
  if (!countryEl || !citySelectEl) return;
  countryEl.addEventListener("change", () => {
    populateCitySelect(citySelectEl, cityOtherEl, countryEl.value === "__other__" ? "" : countryEl.value);
  });
  citySelectEl.addEventListener("change", () => onCitySelectChange(citySelectEl, cityOtherEl));
}

const authStatus = byId("auth-status");
const signedInEmail = byId("signed-in-email");
const lastLoginAt = byId("last-login-at");
const currentModeLabel = byId("current-mode-label");
const roleLockNotice = byId("role-lock-notice");

const signInForm = byId("signin-form");
const signInEmail = byId("signin-email");
const signInPassword = byId("signin-password");

const signUpForm = byId("signup-form");
const signUpEmail = byId("signup-email");
const signUpPassword = byId("signup-password");

const confirmForm = byId("confirm-form");
const confirmEmail = byId("confirm-email");
const confirmCode = byId("confirm-code");

const resetRequestForm = byId("reset-request-form");
const resetRequestEmail = byId("reset-request-email");

const resetConfirmForm = byId("reset-confirm-form");
const resetConfirmEmail = byId("reset-confirm-email");
const resetConfirmCode = byId("reset-confirm-code");
const resetConfirmPassword = byId("reset-confirm-password");

const goSignUp = byId("go-signup");
const goResetRequest = byId("go-reset-request");
const goLoginFromSignup = byId("go-login-from-signup");
const goLoginFromVerify = byId("go-login-from-verify");
const goLoginFromResetRequest = byId("go-login-from-reset-request");
const goLoginFromResetConfirm = byId("go-login-from-reset-confirm");

const authSignoutBtn = byId("auth-signout");
const fullSignoutBtn = byId("full-signout-btn");
const accountProfileForm = byId("account-profile-form");
const accountName = byId("account-name");
const accountCountry = byId("account-country");
const accountCity = byId("account-city");
const accountCityOther = byId("account-city-other");
const accountCategory = byId("account-category");
const accountRate = byId("account-rate");
const workspaceArtistPreview = byId("workspace-artist-preview");

const accountPreferencesForm = byId("account-preferences-form");
const prefBookingUpdates = byId("pref-booking-updates");
const prefMessageAlerts = byId("pref-message-alerts");
const prefMarketingEmails = byId("pref-marketing-emails");
const enableBrowserNotificationsBtn = byId("enable-browser-notifications");

const statSavedArtists = byId("stat-saved-artists");
const statUserBookings = byId("stat-user-bookings");
const statArtistBookings = byId("stat-artist-bookings");
const statUnreadUpdates = byId("stat-unread-updates");

const openResetFromSettingsBtn = byId("open-reset-from-settings");
const exportAccountDataBtn = byId("export-account-data");
const clearSavedArtistsBtn = byId("clear-saved-artists");
const workspaceRefreshBtn = byId("workspace-refresh-btn");

const workspaceSavedArtists = byId("workspace-saved-artists");
const workspaceSavedEmpty = byId("workspace-saved-empty");
const workspaceBookingsList = byId("workspace-bookings-list");
const workspaceBookingsEmpty = byId("workspace-bookings-empty");
const workspaceMessageForm = byId("workspace-message-form");
const workspaceMessageBooking = byId("workspace-message-booking");
const workspaceMessageBody = byId("workspace-message-body");
const workspaceMessagesList = byId("workspace-messages-list");
const workspaceMessagesEmpty = byId("workspace-messages-empty");
const workspaceNotificationsList = byId("workspace-notifications-list");
const workspaceNotificationsEmpty = byId("workspace-notifications-empty");
const workspaceMarkNotificationsRead = byId("workspace-mark-notifications-read");
const setupShell = byId("setup-shell");
const settingsShell = byId("settings-shell");
const setupProgressTitle = byId("setup-progress-title");
const setupProgressLabel = byId("setup-progress-label");
const setupProgressBar = byId("setup-progress-bar");
const setupWelcomeNext = byId("setup-welcome-next");
const setupProfileForm = byId("setup-profile-form");
const setupName = byId("setup-name");
const setupCountry = byId("setup-country");
const setupCity = byId("setup-city");
const setupCityOther = byId("setup-city-other");
const setupCategory = byId("setup-category");
const setupRate = byId("setup-rate");
const setupProfileBack = byId("setup-profile-back");
const setupPreferencesForm = byId("setup-preferences-form");
const setupPrefBookingUpdates = byId("setup-pref-booking-updates");
const setupPrefMessageAlerts = byId("setup-pref-message-alerts");
const setupPrefMarketingEmails = byId("setup-pref-marketing-emails");
const setupPrefBrowserNotifications = byId("setup-pref-browser-notifications");
const setupPreferencesBack = byId("setup-preferences-back");
const setupReviewProfileTitle = byId("setup-review-profile-title");
const setupReviewProfileCopy = byId("setup-review-profile-copy");
const setupReviewPreferencesTitle = byId("setup-review-preferences-title");
const setupReviewPreferencesCopy = byId("setup-review-preferences-copy");
const setupReviewBack = byId("setup-review-back");
const setupFinish = byId("setup-finish");
const settingsSectionButtons = Array.from(document.querySelectorAll("[data-settings-section-btn]"));
const settingsShortcutButtons = Array.from(document.querySelectorAll("[data-settings-shortcut]"));
const settingsSections = Array.from(document.querySelectorAll("[data-settings-section]"));
const setupSteps = Array.from(document.querySelectorAll("[data-setup-step]"));

const views = Array.from(document.querySelectorAll("[data-auth-view]"));

populateCountrySelect(setupCountry);
populateCitySelect(setupCity, setupCityOther, "");
wireLocationSelects(setupCountry, setupCity, setupCityOther);

populateCountrySelect(accountCountry);
populateCitySelect(accountCity, accountCityOther, "");
wireLocationSelects(accountCountry, accountCity, accountCityOther);

let currentView = "login";
let activeSettingsSection = "overview";
const DEFAULT_ACCOUNT_PREFERENCES = {
  bookingUpdates: true,
  messageAlerts: true,
  marketingEmails: false,
  browserNotifications: false,
};
const DEFAULT_USER_SETUP = {
  status: "not_started",
  currentStep: "welcome",
  artistOptIn: false,
  completedAt: null,
};

function titleize(value) {
  return String(value || "")
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getAccountPreferences(session) {
  const context = signedInContext(session);
  if (!context?.user?.preferences) {
    return { ...DEFAULT_ACCOUNT_PREFERENCES };
  }
  return {
    ...DEFAULT_ACCOUNT_PREFERENCES,
    ...context.user.preferences,
  };
}

function getAccountSetup(session) {
  const context = signedInContext(session);
  if (!context?.user?.setup) {
    return { ...DEFAULT_USER_SETUP };
  }

  return {
    ...DEFAULT_USER_SETUP,
    ...context.user.setup,
  };
}

const CATEGORIES = [
  "Illustration", "Branding", "Photography", "Character Design",
  "Motion Graphics", "UI Design", "Album Art", "Editorial",
  "Graphic Design", "Animation", "3D Art", "Web Design",
  "Typography", "Print Design", "Concept Art", "Fashion Design",
  "Interior Design", "Architecture", "Video Production", "Copywriting",
];

function populateCategorySelect(selectEl, selectedValue = "") {
  if (!selectEl) return;
  selectEl.innerHTML = '<option value="">Select a category</option>';
  for (const cat of CATEGORIES) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    if (cat === selectedValue) opt.selected = true;
    selectEl.appendChild(opt);
  }
}

function getSetupSequence() {
  return ["welcome", "profile", "preferences", "review"];
}

function getCurrentSetupStep(setup) {
  const sequence = getSetupSequence();
  return sequence.includes(setup?.currentStep) ? setup.currentStep : sequence[0];
}

function signedInContext(session = getSession()) {
  if (!isCognitoAuthenticated() || !session?.cognitoEmail) {
    return null;
  }

  const db = getDB();
  return {
    db,
    user: getUserById(db, session.activeUserId),
    artist: getArtistById(db, session.activeArtistId),
    session,
  };
}

function setElementDisabled(element, disabled) {
  if (element && "disabled" in element) {
    element.disabled = disabled;
  }
}

function setSettingsInteractive(enabled) {
  const disabled = !enabled;

  [accountName, accountCountry, accountCity, accountCityOther, accountCategory, accountRate].forEach((element) => setElementDisabled(element, disabled));
  [prefBookingUpdates, prefMessageAlerts, prefMarketingEmails].forEach((element) =>
    setElementDisabled(element, disabled),
  );
  [
    workspaceRefreshBtn,
    enableBrowserNotificationsBtn,
    openResetFromSettingsBtn,
    exportAccountDataBtn,
    clearSavedArtistsBtn,
    workspaceMessageBooking,
    workspaceMessageBody,
    workspaceMarkNotificationsRead,
  ].forEach((element) => setElementDisabled(element, disabled));
}

function writeText(node, value) {
  if (!node) {
    return;
  }
  node.textContent = String(value);
}

function renderHeaderSessionState(session) {
  const text = session?.cognitoEmail ? `Signed in: ${session.cognitoEmail}` : "Session: signed out";

  document.querySelectorAll("[data-role-chip]").forEach((node) => {
    node.textContent = text;
  });
}

function formatDateTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) {
    return "A$0";
  }
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function clearNode(node) {
  if (!node) {
    return;
  }
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function normalizeStatusLabel(status) {
  const text = String(status || "").trim();
  if (!text) {
    return "Unknown";
  }
  return text
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function setCollectionEmptyState(node, emptyNode, isEmpty, emptyText) {
  if (node) {
    node.hidden = isEmpty;
  }
  if (emptyNode) {
    emptyNode.hidden = !isEmpty;
    if (emptyText) {
      emptyNode.textContent = emptyText;
    }
  }
}

function uniqueValues(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function artistProfileStatus(artist) {
  const summary = getArtistPublishSummary(artist);
  if (summary.publishState === "live") {
    return "Live";
  }
  if (summary.publishState === "ready") {
    return "Ready";
  }
  return "Draft";
}

function artistVisibilityButtonLabel(artist) {
  return getArtistPublishSummary(artist).publishState === "live" ? "Hide profile" : "Show profile";
}

function parseMediumsInput(value) {
  return uniqueValues(
    String(value || "")
      .split(/[,\n]/)
      .map((part) => titleize(part))
      .filter(Boolean),
  );
}

function renderCategoryOptions(input, datalist, db, selectedValue = "") {
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const options = db.categories
    .filter((category) => category.active)
    .map((category) => category.name);
  const current = selectedValue || options[0] || "Illustration";
  const values = uniqueValues([current, ...options]);
  input.value = current;

  if (!(datalist instanceof HTMLDataListElement)) {
    return;
  }

  datalist.replaceChildren();
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    datalist.appendChild(option);
  });
}

function bookingActionsForContext(booking, context) {
  const actions = [];
  const isUserBooking = Boolean(context.user && booking.userId === context.user.id);
  const isArtistBooking = Boolean(context.artist && booking.artistId === context.artist.id);

  if (isArtistBooking && booking.status === "requested") {
    actions.push({ label: "Accept", status: "accepted", actorRole: "artist" });
    actions.push({ label: "Decline", status: "declined", actorRole: "artist" });
  }

  if (isUserBooking && booking.status === "accepted") {
    actions.push({ label: "Confirm", status: "confirmed", actorRole: "user" });
  }

  if (isUserBooking && (booking.status === "confirmed" || booking.status === "payment_pending")) {
    actions.push({ label: "Mark paid", status: "paid", actorRole: "user" });
  }

  if (isUserBooking && booking.status === "paid") {
    actions.push({ label: "Complete", status: "completed", actorRole: "user" });
  }

  if (
    (isUserBooking || isArtistBooking) &&
    ["requested", "accepted", "confirmed", "payment_pending", "paid"].includes(booking.status)
  ) {
    actions.push({ label: "Cancel", status: "cancelled", actorRole: isArtistBooking ? "artist" : "user" });
  }

  return actions;
}

function renderSavedArtists(context) {
  clearNode(workspaceSavedArtists);

  const saved = context.user?.savedArtistIds || context.user?.savedArtists || [];
  const artists = context.db.artists.filter((artist) => saved.includes(artist.id));
  const empty = artists.length === 0;
  setCollectionEmptyState(workspaceSavedArtists, workspaceSavedEmpty, empty, "No saved artists yet.");
  if (empty || !workspaceSavedArtists) {
    return;
  }

  artists.forEach((artist) => {
    const item = document.createElement("li");
    item.className = "collection-item workspace-item";

    const title = document.createElement("h4");
    title.textContent = artist.name || "Artist";
    item.appendChild(title);

    const meta = document.createElement("p");
    meta.className = "muted";
    meta.textContent = `${artist.category || "Category"} · ${artist.location || "Location pending"}`;
    item.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "form-actions";

    const viewLink = document.createElement("a");
    viewLink.className = "btn btn-outline btn-small";
    viewLink.href = `/artist-preview.html?id=${encodeURIComponent(artist.id)}`;
    viewLink.textContent = "View";
    actions.appendChild(viewLink);

    const removeBtn = document.createElement("button");
    removeBtn.className = "btn btn-ghost btn-small";
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    removeBtn.addEventListener("click", async () => {
      try {
        await toggleSaveArtist(context.user?.id, artist.id);
        await hydratePrivateDB();
        syncSessionFromExisting();
        showToast("Saved artist removed.", "success");
      } catch (error) {
        showToast(error?.message || "Could not update saved artists.", "danger");
      }
    });
    actions.appendChild(removeBtn);

    item.appendChild(actions);
    workspaceSavedArtists.appendChild(item);
  });
}

function renderBookings(context) {
  clearNode(workspaceBookingsList);

  const bookings = context.db.bookings
    .filter(
      (booking) =>
        (context.user && booking.userId === context.user.id) ||
        (context.artist && booking.artistId === context.artist.id),
    )
    .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime());

  const empty = bookings.length === 0;
  setCollectionEmptyState(workspaceBookingsList, workspaceBookingsEmpty, empty, "No bookings yet.");
  if (empty || !workspaceBookingsList) {
    return;
  }

  bookings.forEach((booking) => {
    const artist = context.db.artists.find((item) => item.id === booking.artistId);
    const user = context.db.users.find((item) => item.id === booking.userId);
    const bookingLabel = booking.serviceLabel || artist?.category || "Profile request";

    const item = document.createElement("li");
    item.className = "collection-item workspace-item";

    const heading = document.createElement("h4");
    heading.textContent = `${bookingLabel} · ${booking.id}`;
    item.appendChild(heading);

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = `${formatCurrency(booking.budget)} · Due ${booking.deadline || "-"} · Client ${user?.name || "-"} · Artist ${artist?.name || "-"}`;
    item.appendChild(detail);

    const metaRow = document.createElement("div");
    metaRow.className = "meta-row";
    const status = document.createElement("span");
    status.className = `status-badge status-${booking.status}`;
    status.textContent = normalizeStatusLabel(booking.status);
    metaRow.appendChild(status);

    const updatedAt = document.createElement("span");
    updatedAt.textContent = `Updated ${formatDateTime(booking.updatedAt)}`;
    metaRow.appendChild(updatedAt);
    item.appendChild(metaRow);

    const actions = bookingActionsForContext(booking, context);
    if (actions.length) {
      const actionRow = document.createElement("div");
      actionRow.className = "form-actions";
      actions.forEach((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = action.status === "cancelled" ? "btn btn-ghost btn-small" : "btn btn-outline btn-small";
        button.textContent = action.label;
        button.addEventListener("click", async () => {
          try {
            const result = await updateBookingStatus(booking.id, action.status, action.actorRole);
            if (!result.ok) {
              showToast("Booking status update failed.", "warning");
              return;
            }
            syncSessionFromExisting();
            showToast(`Booking updated to ${normalizeStatusLabel(action.status)}.`, "success");
          } catch (error) {
            showToast(error?.message || "Booking status update failed.", "danger");
          }
        });
        actionRow.appendChild(button);
      });
      item.appendChild(actionRow);
    }

    workspaceBookingsList.appendChild(item);
  });
}

function renderMessageOptions(context, relatedBookings) {
  clearNode(workspaceMessageBooking);
  if (!workspaceMessageBooking) {
    return;
  }

  if (!relatedBookings.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No booking threads available";
    workspaceMessageBooking.appendChild(option);
    workspaceMessageBooking.disabled = true;
    return;
  }

  workspaceMessageBooking.disabled = false;
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select booking thread";
  workspaceMessageBooking.appendChild(placeholder);

  relatedBookings.forEach((booking) => {
    const option = document.createElement("option");
    option.value = booking.id;
    option.textContent = `${booking.id} · ${booking.serviceLabel || "Profile request"} · ${normalizeStatusLabel(booking.status)}`;
    workspaceMessageBooking.appendChild(option);
  });
}

function renderMessages(context) {
  clearNode(workspaceMessagesList);
  const ownerIds = new Set([context.user?.id, context.artist?.id].filter(Boolean));

  const messages = context.db.messages
    .filter((message) => ownerIds.has(message.fromId) || ownerIds.has(message.toId))
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 20);

  const empty = messages.length === 0;
  setCollectionEmptyState(workspaceMessagesList, workspaceMessagesEmpty, empty, "No messages yet.");
  if (empty || !workspaceMessagesList) {
    return;
  }

  messages.forEach((message) => {
    const fromUser = context.db.users.find((item) => item.id === message.fromId);
    const fromArtist = context.db.artists.find((item) => item.id === message.fromId);
    const mine = message.fromId === context.user?.id || message.fromId === context.artist?.id;

    const item = document.createElement("li");
    item.className = "collection-item workspace-item";

    const title = document.createElement("h4");
    title.textContent = `${mine ? "You" : fromUser?.name || fromArtist?.name || "Member"} · ${formatDateTime(message.createdAt)}`;
    item.appendChild(title);

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = message.bookingId ? `Thread ${message.bookingId}` : "General thread";
    item.appendChild(detail);

    const body = document.createElement("p");
    body.textContent = message.body || "";
    item.appendChild(body);

    workspaceMessagesList.appendChild(item);
  });
}

function renderNotifications(context) {
  clearNode(workspaceNotificationsList);

  const notifications = context.db.notifications
    .filter(
      (notification) =>
        (context.user && notification.role === "user" && notification.ownerId === context.user.id) ||
        (context.artist && notification.role === "artist" && notification.ownerId === context.artist.id),
    )
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    .slice(0, 24);

  const empty = notifications.length === 0;
  setCollectionEmptyState(
    workspaceNotificationsList,
    workspaceNotificationsEmpty,
    empty,
    "No notifications yet.",
  );
  if (empty || !workspaceNotificationsList) {
    return;
  }

  notifications.forEach((notification) => {
    const item = document.createElement("li");
    item.className = `collection-item workspace-item${notification.read ? "" : " is-unread"}`;

    const title = document.createElement("h4");
    title.textContent = notification.title || "Update";
    item.appendChild(title);

    const detail = document.createElement("p");
    detail.className = "muted";
    detail.textContent = `${normalizeStatusLabel(notification.type || "update")} · ${formatDateTime(notification.createdAt)}`;
    item.appendChild(detail);

    const body = document.createElement("p");
    body.textContent = notification.detail || "";
    item.appendChild(body);

    workspaceNotificationsList.appendChild(item);
  });
}

function renderAccountPanels(session) {
  const context = signedInContext(session);

  if (!context) {
    setSettingsInteractive(false);
    if (accountName instanceof HTMLInputElement) {
      accountName.value = "";
    }
    if (accountCountry) accountCountry.value = "";
    populateCitySelect(accountCity, accountCityOther, "");
    if (accountCityOther) { accountCityOther.value = ""; accountCityOther.hidden = true; }
    populateCategorySelect(accountCategory);
    if (accountRate instanceof HTMLSelectElement) accountRate.value = "0";
    if (prefBookingUpdates instanceof HTMLInputElement) {
      prefBookingUpdates.checked = DEFAULT_ACCOUNT_PREFERENCES.bookingUpdates;
    }
    if (prefMessageAlerts instanceof HTMLInputElement) {
      prefMessageAlerts.checked = DEFAULT_ACCOUNT_PREFERENCES.messageAlerts;
    }
    if (prefMarketingEmails instanceof HTMLInputElement) {
      prefMarketingEmails.checked = DEFAULT_ACCOUNT_PREFERENCES.marketingEmails;
    }
    writeText(statSavedArtists, 0);
    writeText(statUserBookings, 0);
    writeText(statArtistBookings, 0);
    writeText(statUnreadUpdates, 0);
    clearNode(workspaceSavedArtists);
    clearNode(workspaceBookingsList);
    clearNode(workspaceMessagesList);
    clearNode(workspaceNotificationsList);
    clearNode(workspaceMessageBooking);
    setCollectionEmptyState(workspaceSavedArtists, workspaceSavedEmpty, true, "No saved artists yet.");
    setCollectionEmptyState(workspaceBookingsList, workspaceBookingsEmpty, true, "No bookings yet.");
    setCollectionEmptyState(workspaceMessagesList, workspaceMessagesEmpty, true, "No messages yet.");
    setCollectionEmptyState(workspaceNotificationsList, workspaceNotificationsEmpty, true, "No notifications yet.");
    if (workspaceArtistPreview instanceof HTMLAnchorElement) {
      workspaceArtistPreview.href = "/artist-preview.html";
    }
    return;
  }

  setSettingsInteractive(true);

  const { db, user, artist } = context;
  const fallbackName = titleize(
    String(session.cognitoEmail || "").split("@")[0] || "Member",
  );
  const preferences = getAccountPreferences(session);

  if (accountName instanceof HTMLInputElement) {
    accountName.value = user?.name || fallbackName;
  }

  setLocationFields(accountCountry, accountCity, accountCityOther, user?.location || "");

  populateCategorySelect(accountCategory, artist?.category || "");
  if (accountRate instanceof HTMLSelectElement) {
    const priceFrom = String(artist?.priceFrom || "0");
    accountRate.value = [...accountRate.options].find((o) => o.value === priceFrom) ? priceFrom : "0";
  }
  if (workspaceArtistPreview instanceof HTMLAnchorElement) {
    workspaceArtistPreview.href = artist?.id
      ? `/artist-preview.html?id=${encodeURIComponent(artist.id)}`
      : "/artist-preview.html";
  }

  if (prefBookingUpdates instanceof HTMLInputElement) {
    prefBookingUpdates.checked = Boolean(preferences.bookingUpdates);
  }

  if (prefMessageAlerts instanceof HTMLInputElement) {
    prefMessageAlerts.checked = Boolean(preferences.messageAlerts);
  }

  if (prefMarketingEmails instanceof HTMLInputElement) {
    prefMarketingEmails.checked = Boolean(preferences.marketingEmails);
  }

  const savedArtistsCount = Array.isArray(user?.savedArtistIds) ? user.savedArtistIds.length : 0;
  writeText(statSavedArtists, savedArtistsCount);

  const userBookings = db.bookings.filter((booking) => user && booking.userId === user.id);
  const artistBookings = db.bookings.filter((booking) => artist && booking.artistId === artist.id);
  writeText(statUserBookings, userBookings.length);
  writeText(statArtistBookings, artistBookings.length);

  const unreadCount = db.notifications.filter(
    (notification) =>
      !notification.read &&
      ((user && notification.role === "user" && notification.ownerId === user.id) ||
        (artist && notification.role === "artist" && notification.ownerId === artist.id)),
  ).length;
  writeText(statUnreadUpdates, unreadCount);

  renderSavedArtists(context);
  renderBookings(context);
  const messageBookings = Array.from(
    new Map([...userBookings, ...artistBookings].map((booking) => [booking.id, booking])).values(),
  );
  renderMessageOptions(context, messageBookings);
  renderMessages(context);
  renderNotifications(context);
}

function setupStepLabel(step) {
  const labels = {
    welcome: "Welcome",
    profile: "Your details",
    preferences: "Updates and alerts",
    review: "Review and finish",
    done: "Account ready",
  };
  return labels[step] || titleize(step);
}

function setActiveSettingsSection(sectionId) {
  const available = settingsSections.map((section) => section.getAttribute("data-settings-section"));
  activeSettingsSection = available.includes(sectionId) ? sectionId : "overview";

  settingsSections.forEach((section) => {
    section.hidden = section.getAttribute("data-settings-section") !== activeSettingsSection;
  });

  settingsSectionButtons.forEach((button) => {
    const active = button.getAttribute("data-settings-section-btn") === activeSettingsSection;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
}

function renderSetup(context) {
  const session = context.session;
  const setup = getAccountSetup(session);
  const currentStep = getCurrentSetupStep(setup);
  const sequence = getSetupSequence();
  const currentIndex = Math.max(0, sequence.indexOf(currentStep));
  const progress = ((currentIndex + 1) / sequence.length) * 100;
  const preferences = getAccountPreferences(session);
  const user = context.user;
  const artist = context.artist;
  const fallbackName = titleize(String(session.cognitoEmail || "").split("@")[0] || "Member");

  if (setupProgressTitle) {
    setupProgressTitle.textContent = setupStepLabel(currentStep);
  }
  if (setupProgressLabel) {
    setupProgressLabel.textContent = `Step ${currentIndex + 1} of ${sequence.length}`;
  }
  if (setupProgressBar) {
    setupProgressBar.style.width = `${progress}%`;
  }

  setupSteps.forEach((step) => {
    step.hidden = step.getAttribute("data-setup-step") !== currentStep;
  });

  if (setupName instanceof HTMLInputElement) {
    setupName.value = user?.name || fallbackName;
  }
  setLocationFields(setupCountry, setupCity, setupCityOther, user?.location || "");
  populateCategorySelect(setupCategory, artist?.category || "");
  if (setupRate instanceof HTMLSelectElement) {
    const priceFrom = String(artist?.priceFrom || "0");
    setupRate.value = [...setupRate.options].find((o) => o.value === priceFrom) ? priceFrom : "0";
  }

  if (setupPrefBookingUpdates instanceof HTMLInputElement) {
    setupPrefBookingUpdates.checked = Boolean(preferences.bookingUpdates);
  }
  if (setupPrefMessageAlerts instanceof HTMLInputElement) {
    setupPrefMessageAlerts.checked = Boolean(preferences.messageAlerts);
  }
  if (setupPrefMarketingEmails instanceof HTMLInputElement) {
    setupPrefMarketingEmails.checked = Boolean(preferences.marketingEmails);
  }
  if (setupPrefBrowserNotifications instanceof HTMLInputElement) {
    setupPrefBrowserNotifications.checked = Boolean(preferences.browserNotifications);
  }

  if (setupReviewProfileTitle) {
    setupReviewProfileTitle.textContent = user?.name || fallbackName;
  }
  if (setupReviewProfileCopy) {
    const parts = [user?.location || null, artist?.category || null];
    setupReviewProfileCopy.textContent = parts.filter(Boolean).join(" · ") || "Basic details saved.";
  }
  if (setupReviewPreferencesTitle) {
    const enabledCount = [
      preferences.bookingUpdates,
      preferences.messageAlerts,
      preferences.marketingEmails,
      preferences.browserNotifications,
    ].filter(Boolean).length;
    setupReviewPreferencesTitle.textContent = `${enabledCount} preference${enabledCount === 1 ? "" : "s"} on`;
  }
  if (setupReviewPreferencesCopy) {
    const labels = [
      preferences.bookingUpdates ? "Bookings" : null,
      preferences.messageAlerts ? "Messages" : null,
      preferences.marketingEmails ? "Product emails" : null,
      preferences.browserNotifications ? "Browser alerts" : null,
    ].filter(Boolean);
    setupReviewPreferencesCopy.textContent = labels.join(", ") || "No optional alerts enabled.";
  }
}

function renderSignedInExperience(session) {
  const context = signedInContext(session);
  if (!context) {
    if (setupShell) {
      setupShell.hidden = true;
    }
    if (settingsShell) {
      settingsShell.hidden = true;
    }
    return;
  }

  const setup = getAccountSetup(session);
  const setupIncomplete = setup.status !== "completed";

  if (setupShell) {
    setupShell.hidden = !setupIncomplete;
  }
  if (settingsShell) {
    settingsShell.hidden = setupIncomplete;
  }

  if (setupIncomplete) {
    renderSetup(context);
    return;
  }

  renderAccountPanels(session);
  setActiveSettingsSection(activeSettingsSection);
}

function showView(nextView) {
  currentView = nextView;
  views.forEach((section) => {
    section.hidden = section.getAttribute("data-auth-view") !== nextView;
  });
}

function showDefaultAccountView() {
  const session = getSession();
  if (isCognitoAuthenticated() && session?.cognitoEmail) {
    showView("signed_in");
    return;
  }

  showView("login");
}

function setSignedInControls(enabled) {
  if (roleLockNotice) {
    roleLockNotice.style.display = enabled ? "none" : "block";
  }
}

function renderLastLogin(session) {
  if (!lastLoginAt) {
    return;
  }

  if (!session?.lastLoginAt) {
    lastLoginAt.textContent = "-";
    return;
  }

  const date = new Date(session.lastLoginAt);
  if (Number.isNaN(date.getTime())) {
    lastLoginAt.textContent = "-";
    return;
  }

  lastLoginAt.textContent = date.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderAuthStatus(session) {
  const signedIn = isCognitoAuthenticated() && Boolean(session.cognitoEmail);
  const setup = signedIn ? getAccountSetup(session) : DEFAULT_USER_SETUP;
  const setupIncomplete = signedIn && setup.status !== "completed";

  if (authStatus) {
    authStatus.textContent = signedIn
      ? setupIncomplete
        ? "Complete your setup to finish preparing the account."
        : "Your account is ready."
      : "Log in to continue.";
  }

  if (signedInEmail) {
    signedInEmail.textContent = signedIn ? session.cognitoEmail : "-";
  }

  renderLastLogin(session);

  if (currentModeLabel) {
    currentModeLabel.textContent = signedIn ? (setupIncomplete ? "Account setup" : "Workspace ready") : "Sign in required";
  }

  renderHeaderSessionState(session);
  setSignedInControls(signedIn);
  renderSignedInExperience(session);
}

function isInlineAuthFlow(viewName) {
  return ["signup", "verify", "reset_request", "reset_confirm"].includes(viewName);
}

function syncSessionFromExisting(options = {}) {
  const { skipIdentityProvision = false } = options;
  let session = getSession();
  const signedIn = isCognitoAuthenticated() && Boolean(session.cognitoEmail);

  if (signedIn && !skipIdentityProvision) {
    session = ensureLinkedProfiles(session);
  }

  renderAuthStatus(session);

  if (signedIn) {
    if (!isInlineAuthFlow(currentView)) {
      showView("signed_in");
    }
    return;
  }

  showView("login");
}

function ensureLinkedProfiles(session) {
  if (!session?.cognitoSub) {
    return session;
  }

  const identity = {
    sub: session.cognitoSub,
    email: session.cognitoEmail,
    username: session.cognitoUsername,
  };

  const user = ensureUserForCognito(identity);
  const artist = ensureArtistForCognito(identity);

  return setSession({
    ...session,
    role: "none",
    activeUserId: user?.id || session.activeUserId || null,
    activeArtistId: artist?.id || session.activeArtistId || null,
    cognitoEmail: identity.email || null,
    cognitoSub: identity.sub || null,
    cognitoUsername: identity.username || null,
  });
}

async function hydrateCognitoState() {
  const identity = await ensureCognitoSession();

  if (!identity) {
    clearCognitoIdentity();
    syncSessionFromExisting({ skipIdentityProvision: true });
    return;
  }

  setCognitoIdentity(identity);

  setSession({
    ...getSession(),
    cognitoEmail: identity.email || null,
    cognitoSub: identity.sub || null,
    cognitoUsername: identity.username || null,
    lastLoginAt: getSession().lastLoginAt || new Date().toISOString(),
  });

  await hydratePrivateDB();
  syncSessionFromExisting();
}

function buildAccountExport(context) {
  const { db, user, artist, session } = context;
  const ownerIds = new Set();

  if (user?.id) {
    ownerIds.add(user.id);
  }
  if (artist?.id) {
    ownerIds.add(artist.id);
  }

  const notifications = db.notifications.filter(
    (notification) =>
      (user && notification.role === "user" && notification.ownerId === user.id) ||
      (artist && notification.role === "artist" && notification.ownerId === artist.id),
  );

  const bookings = db.bookings.filter(
    (booking) => (user && booking.userId === user.id) || (artist && booking.artistId === artist.id),
  );

  return {
    exportedAt: new Date().toISOString(),
    account: {
      email: session.cognitoEmail || null,
      cognitoSub: session.cognitoSub || null,
      userId: user?.id || null,
      artistId: artist?.id || null,
    },
    profile: {
      user: user || null,
      artist: artist || null,
    },
    preferences: user?.preferences || getAccountPreferences(session),
    savedArtists: db.artists.filter(
      (candidate) => Array.isArray(user?.savedArtistIds) && user.savedArtistIds.includes(candidate.id),
    ),
    bookings,
    messages: db.messages.filter((message) => ownerIds.has(message.fromId) || ownerIds.has(message.toId)),
    notifications,
    invoices: db.invoices.filter(
      (invoice) => (user && invoice.userId === user.id) || (artist && invoice.artistId === artist.id),
    ),
    payouts: db.payouts.filter((payout) => artist && payout.artistId === artist.id),
  };
}

function downloadJsonFile(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function clearAuthFormFields() {
  [
    signInEmail,
    signInPassword,
    signUpEmail,
    signUpPassword,
    confirmEmail,
    confirmCode,
    resetRequestEmail,
    resetConfirmEmail,
    resetConfirmCode,
    resetConfirmPassword,
  ].forEach((field) => {
    if (field instanceof HTMLInputElement) {
      field.value = "";
    }
  });
}

function getSignedInWizardContext() {
  return signedInContext(ensureLinkedProfiles(getSession()));
}

async function resolveBrowserNotificationPreference(requested) {
  if (!requested) {
    return false;
  }

  if (!("Notification" in window)) {
    showToast("Browser notifications are not supported on this device.", "warning");
    return false;
  }

  if (Notification.permission === "granted") {
    return true;
  }

  if (Notification.permission === "denied") {
    showToast("Browser alerts are blocked in browser settings.", "warning");
    return false;
  }

  const result = await Notification.requestPermission();
  if (result !== "granted") {
    showToast("Browser alerts were not enabled.", "warning");
    return false;
  }

  return true;
}

settingsSectionButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveSettingsSection(button.getAttribute("data-settings-section-btn") || "overview");
  });
});

settingsShortcutButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveSettingsSection(button.getAttribute("data-settings-shortcut") || "overview");
  });
});

setupWelcomeNext?.addEventListener("click", async () => {
  const context = getSignedInWizardContext();
  if (!context?.user?.id) {
    showToast("Sign in to continue setup.", "warning");
    return;
  }

  try {
    await updateUserSetup(context.user.id, {
      status: "in_progress",
      currentStep: "profile",
    });
    syncSessionFromExisting();
  } catch (error) {
    showToast(error?.message || "Could not continue setup.", "danger");
  }
});

setupProfileBack?.addEventListener("click", async () => {
  const context = getSignedInWizardContext();
  if (!context?.user?.id) {
    return;
  }

  try {
    await updateUserSetup(context.user.id, {
      status: "in_progress",
      currentStep: "welcome",
    });
    syncSessionFromExisting();
  } catch (error) {
    showToast(error?.message || "Could not return to the previous step.", "danger");
  }
});

setupProfileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const context = getSignedInWizardContext();
  if (!context?.user?.id) {
    showToast("Sign in to continue setup.", "warning");
    return;
  }

  const name = String(setupName?.value || "").trim();
  const location = getLocationFromFields(setupCountry, setupCity, setupCityOther);
  const category = setupCategory?.value || "";
  const priceFrom = Number(setupRate?.value || 0);

  if (!name) {
    showToast("Name is required.", "warning");
    return;
  }

  try {
    await updateUserProfile(context.user.id, {
      name,
      location,
      profileCompleted: true,
    });
    const artist = ensureArtistForCognito({ sub: context.session.cognitoSub, email: context.session.cognitoEmail, username: context.session.cognitoUsername });
    if (artist?.id) {
      await updateArtistProfile(artist.id, {
        category,
        priceFrom,
        profileVisible: Boolean(category),
      });
    }
    await hydratePrivateDB();
    syncSessionFromExisting();
  } catch (error) {
    showToast(error?.message || "Could not save your details.", "danger");
  }
});

setupPreferencesBack?.addEventListener("click", async () => {
  const context = getSignedInWizardContext();
  if (!context?.user?.id) {
    return;
  }

  try {
    await updateUserSetup(context.user.id, {
      status: "in_progress",
      currentStep: "profile",
    });
    syncSessionFromExisting();
  } catch (error) {
    showToast(error?.message || "Could not return to the previous step.", "danger");
  }
});

setupPreferencesForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const context = getSignedInWizardContext();
  if (!context?.user?.id) {
    showToast("Sign in to continue setup.", "warning");
    return;
  }

  try {
    const browserNotifications = await resolveBrowserNotificationPreference(
      Boolean(setupPrefBrowserNotifications?.checked),
    );

    await updateUserPreferences(context.user.id, {
      bookingUpdates: Boolean(setupPrefBookingUpdates?.checked),
      messageAlerts: Boolean(setupPrefMessageAlerts?.checked),
      marketingEmails: Boolean(setupPrefMarketingEmails?.checked),
      browserNotifications,
    });
    await hydratePrivateDB();
    syncSessionFromExisting();
  } catch (error) {
    showToast(error?.message || "Could not save your alert preferences.", "danger");
  }
});

setupReviewBack?.addEventListener("click", async () => {
  const context = getSignedInWizardContext();
  if (!context?.user?.id) {
    return;
  }

  try {
    await updateUserSetup(context.user.id, {
      status: "in_progress",
      currentStep: "preferences",
    });
    syncSessionFromExisting();
  } catch (error) {
    showToast(error?.message || "Could not return to the previous step.", "danger");
  }
});

setupFinish?.addEventListener("click", async () => {
  const context = getSignedInWizardContext();
  if (!context?.user?.id) {
    showToast("Sign in to finish setup.", "warning");
    return;
  }

  try {
    await completeUserSetup(context.user.id);
    await hydratePrivateDB();
    syncSessionFromExisting();
    setActiveSettingsSection("overview");
    showToast("Setup complete.", "success");
  } catch (error) {
    showToast(error?.message || "Could not finish setup.", "danger");
  }
});

const SIGNIN_ATTEMPTS_KEY = "artizans.signin.attempts";
const SIGNIN_LOCKOUT_KEY = "artizans.signin.lockout_until";
const MAX_SIGNIN_ATTEMPTS = 5;
const SIGNIN_LOCKOUT_MS = 5 * 60 * 1000;

function isSigninLocked() {
  const until = Number(sessionStorage.getItem(SIGNIN_LOCKOUT_KEY) || 0);
  return Date.now() < until;
}

function signinLockoutMinutesRemaining() {
  const until = Number(sessionStorage.getItem(SIGNIN_LOCKOUT_KEY) || 0);
  return Math.max(1, Math.ceil((until - Date.now()) / 60000));
}

function recordFailedSignin() {
  const attempts = (Number(sessionStorage.getItem(SIGNIN_ATTEMPTS_KEY)) || 0) + 1;
  if (attempts >= MAX_SIGNIN_ATTEMPTS) {
    sessionStorage.setItem(SIGNIN_LOCKOUT_KEY, String(Date.now() + SIGNIN_LOCKOUT_MS));
    sessionStorage.removeItem(SIGNIN_ATTEMPTS_KEY);
  } else {
    sessionStorage.setItem(SIGNIN_ATTEMPTS_KEY, String(attempts));
  }
}

function clearSigninLockout() {
  sessionStorage.removeItem(SIGNIN_ATTEMPTS_KEY);
  sessionStorage.removeItem(SIGNIN_LOCKOUT_KEY);
}

signInForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isSigninLocked()) {
    const mins = signinLockoutMinutesRemaining();
    showToast(`Too many failed attempts. Try again in ${mins} minute${mins !== 1 ? "s" : ""}.`, "danger");
    return;
  }

  const email = (signInEmail?.value || "").trim();
  const password = signInPassword?.value || "";

  if (!email || !password) {
    showToast("Email and password are required.", "warning");
    return;
  }

  try {
    const identity = await signInCognito({ email, password });
    clearSigninLockout();
    const user = ensureUserForCognito(identity);
    const artist = ensureArtistForCognito(identity);

    setSession({
      ...getSession(),
      role: "none",
      activeUserId: user?.id || null,
      activeArtistId: artist?.id || null,
      cognitoEmail: identity?.email || null,
      cognitoSub: identity?.sub || null,
      cognitoUsername: identity?.username || null,
      lastLoginAt: new Date().toISOString(),
    });

    if (signInPassword) {
      signInPassword.value = "";
    }

    await hydratePrivateDB();
    syncSessionFromExisting();
    showToast("Signed in.", "success");
  } catch (error) {
    recordFailedSignin();
    if (isSigninLocked()) {
      showToast("Too many failed attempts. Sign-in locked for 5 minutes.", "danger");
    } else {
      showToast(error?.message || "Log in failed.", "danger");
    }
  }
});

signUpForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (signUpEmail?.value || "").trim();
  const password = signUpPassword?.value || "";

  if (!email || !password) {
    showToast("Email and password are required.", "warning");
    return;
  }

  try {
    await signUpCognito({ email, password });
    if (confirmEmail) {
      confirmEmail.value = email;
    }
    if (signInEmail) {
      signInEmail.value = email;
    }
    showView("verify");
    showToast("Check your email for a verification code.", "success");
  } catch (error) {
    showToast(error?.message || "Could not create account.", "danger");
  }
});

confirmForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (confirmEmail?.value || "").trim();
  const code = (confirmCode?.value || "").trim();

  if (!email || !code) {
    showToast("Email and verification code are required.", "warning");
    return;
  }

  try {
    await confirmSignUpCognito({ email, code });
    if (confirmCode) {
      confirmCode.value = "";
    }
    showView("login");
    showToast("Email verified. You can log in now.", "success");
  } catch (error) {
    showToast(error?.message || "Verification failed.", "danger");
  }
});

resetRequestForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (resetRequestEmail?.value || "").trim();
  if (!email) {
    showToast("Email is required.", "warning");
    return;
  }

  try {
    await forgotPasswordCognito({ email });
    if (resetConfirmEmail) {
      resetConfirmEmail.value = email;
    }
    showView("reset_confirm");
    showToast("If this email exists, a verification code will be sent.", "success");
  } catch (error) {
    showToast("Could not start password reset right now.", "danger");
  }
});

resetConfirmForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = (resetConfirmEmail?.value || "").trim();
  const code = (resetConfirmCode?.value || "").trim();
  const newPassword = resetConfirmPassword?.value || "";

  if (!email || !code || !newPassword) {
    showToast("Email, verification code, and new password are required.", "warning");
    return;
  }

  try {
    await confirmForgotPasswordCognito({ email, code, newPassword });
    if (signInEmail) {
      signInEmail.value = email;
    }
    if (resetConfirmCode) {
      resetConfirmCode.value = "";
    }
    if (resetConfirmPassword) {
      resetConfirmPassword.value = "";
    }
    showView("login");
    showToast("Password updated. You can log in now.", "success");
  } catch (error) {
    showToast(error?.message || "Password reset failed.", "danger");
  }
});

accountProfileForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const session = ensureLinkedProfiles(getSession());
  const context = signedInContext(session);
  if (!context) {
    showToast("Sign in to update profile details.", "warning");
    return;
  }

  const name = (accountName?.value || "").trim();
  const location = getLocationFromFields(accountCountry, accountCity, accountCityOther);
  const category = accountCategory?.value || "";
  const priceFrom = Number(accountRate?.value || 0);

  if (!name) {
    showToast("Display name is required.", "warning");
    return;
  }

  try {
    if (context.user?.id) {
      await updateUserProfile(context.user.id, {
        name,
        location,
        profileCompleted: true,
      });
    }
    const artist = ensureArtistForCognito({ sub: context.session.cognitoSub, email: context.session.cognitoEmail, username: context.session.cognitoUsername });
    if (artist?.id) {
      await updateArtistProfile(artist.id, {
        category,
        priceFrom,
        profileVisible: Boolean(category),
      });
    }

    await hydratePrivateDB();
    syncSessionFromExisting();
    showToast("Profile saved.", "success");
  } catch (error) {
    showToast(error?.message || "Profile save failed.", "danger");
  }
});

accountPreferencesForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const context = signedInContext(getSession());
  if (!context?.user?.id) {
    showToast("Sign in to update preferences.", "warning");
    return;
  }

  try {
    await updateUserPreferences(context.user.id, {
      bookingUpdates: Boolean(prefBookingUpdates?.checked),
      messageAlerts: Boolean(prefMessageAlerts?.checked),
      marketingEmails: Boolean(prefMarketingEmails?.checked),
      browserNotifications: context.user.preferences?.browserNotifications ?? false,
    });
    await hydratePrivateDB();
    syncSessionFromExisting();
    showToast("Preferences saved.", "success");
  } catch (error) {
    showToast(error?.message || "Preferences save failed.", "danger");
  }
});

enableBrowserNotificationsBtn?.addEventListener("click", async () => {
  const context = signedInContext(getSession());
  if (!("Notification" in window)) {
    showToast("Browser notifications are not supported on this device.", "warning");
    return;
  }

  if (Notification.permission === "granted") {
    showToast("Browser alerts are already enabled.", "success");
    if (context?.user?.id) {
      await updateUserPreferences(context.user.id, {
        ...getAccountPreferences(getSession()),
        browserNotifications: true,
      });
      await hydratePrivateDB();
      syncSessionFromExisting();
    }
    return;
  }

  if (Notification.permission === "denied") {
    showToast("Browser alerts are blocked in browser settings.", "warning");
    if (context?.user?.id) {
      await updateUserPreferences(context.user.id, {
        ...getAccountPreferences(getSession()),
        browserNotifications: false,
      });
      await hydratePrivateDB();
      syncSessionFromExisting();
    }
    return;
  }

  const result = await Notification.requestPermission();
  if (result === "granted") {
    if (context?.user?.id) {
      await updateUserPreferences(context.user.id, {
        ...getAccountPreferences(getSession()),
        browserNotifications: true,
      });
      await hydratePrivateDB();
      syncSessionFromExisting();
    }
    showToast("Browser alerts enabled.", "success");
    return;
  }

  if (context?.user?.id) {
    await updateUserPreferences(context.user.id, {
      ...getAccountPreferences(getSession()),
      browserNotifications: false,
    });
    await hydratePrivateDB();
    syncSessionFromExisting();
  }
  showToast("Browser alerts were not enabled.", "warning");
});

openResetFromSettingsBtn?.addEventListener("click", () => {
  const session = getSession();
  if (resetRequestEmail && session?.cognitoEmail) {
    resetRequestEmail.value = session.cognitoEmail;
  }
  showView("reset_request");
});

exportAccountDataBtn?.addEventListener("click", () => {
  const session = ensureLinkedProfiles(getSession());
  const context = signedInContext(session);
  if (!context) {
    showToast("Sign in before exporting account data.", "warning");
    return;
  }

  const payload = buildAccountExport(context);
  const dateStamp = new Date().toISOString().slice(0, 10);
  downloadJsonFile(`artizans-account-${dateStamp}.json`, payload);
  showToast("Account data export generated.", "success");
});

clearSavedArtistsBtn?.addEventListener("click", async () => {
  const session = ensureLinkedProfiles(getSession());
  const context = signedInContext(session);
  if (!context?.user?.id) {
    showToast("No saved artists found for this account.", "warning");
    return;
  }

  const saved = Array.isArray(context.user.savedArtistIds) ? [...context.user.savedArtistIds] : [];
  if (!saved.length) {
    showToast("No saved artists found for this account.", "warning");
    return;
  }

  try {
    for (const artistId of saved) {
      await toggleSaveArtist(context.user.id, artistId);
    }
    await hydratePrivateDB();
    syncSessionFromExisting();
    showToast("Saved artists cleared.", "success");
  } catch (error) {
    showToast(error?.message || "Could not clear saved artists.", "danger");
  }
});

workspaceRefreshBtn?.addEventListener("click", async () => {
  await hydrateDB();
  await hydratePrivateDB();
  syncSessionFromExisting();
  showToast("Workspace refreshed.", "success");
});

workspaceMessageForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const context = signedInContext(ensureLinkedProfiles(getSession()));
  if (!context) {
    showToast("Sign in to send a message.", "warning");
    return;
  }

  const bookingId = String(workspaceMessageBooking?.value || "").trim();
  const body = String(workspaceMessageBody?.value || "").trim();
  if (!bookingId || !body) {
    showToast("Select a booking thread and write a message.", "warning");
    return;
  }

  const booking = context.db.bookings.find((item) => item.id === bookingId);
  if (!booking) {
    showToast("Booking thread not found.", "warning");
    return;
  }

  let payload = null;
  if (context.user?.id && booking.userId === context.user.id) {
    payload = {
      threadId: booking.threadId,
      bookingId: booking.id,
      fromRole: "user",
      fromId: booking.userId,
      toRole: "artist",
      toId: booking.artistId,
      body,
    };
  } else if (context.artist?.id && booking.artistId === context.artist.id) {
    payload = {
      threadId: booking.threadId,
      bookingId: booking.id,
      fromRole: "artist",
      fromId: booking.artistId,
      toRole: "user",
      toId: booking.userId,
      body,
    };
  }

  if (!payload) {
    showToast("You do not have access to this booking thread.", "warning");
    return;
  }

  const submitBtn = workspaceMessageForm.querySelector('button[type="submit"]');
  const originalBtnText = submitBtn?.textContent || "Send message";
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";
  }

  try {
    const created = await sendMessage(payload);
    if (!created) {
      showToast("Message could not be sent.", "warning");
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
      return;
    }

    if (workspaceMessageBody instanceof HTMLTextAreaElement) {
      workspaceMessageBody.value = "";
    }
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
    await hydratePrivateDB();
    syncSessionFromExisting();
    showToast("Message sent.", "success");
  } catch (error) {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = originalBtnText; }
    showToast(error?.message || "Message could not be sent.", "danger");
  }
});

workspaceMarkNotificationsRead?.addEventListener("click", async () => {
  const context = signedInContext(ensureLinkedProfiles(getSession()));
  if (!context) {
    showToast("Sign in to manage notifications.", "warning");
    return;
  }

  try {
    if (context.user?.id) {
      await markNotificationsRead("user", context.user.id);
    }
    if (context.artist?.id) {
      await markNotificationsRead("artist", context.artist.id);
    }

    syncSessionFromExisting();
    showToast("Notifications marked as read.", "success");
  } catch (error) {
    showToast(error?.message || "Could not update notifications.", "danger");
  }
});

goSignUp?.addEventListener("click", () => showView("signup"));
goResetRequest?.addEventListener("click", () => {
  if (resetRequestEmail && signInEmail?.value) {
    resetRequestEmail.value = signInEmail.value;
  }
  showView("reset_request");
});

goLoginFromSignup?.addEventListener("click", () => showDefaultAccountView());
goLoginFromVerify?.addEventListener("click", () => showDefaultAccountView());
goLoginFromResetRequest?.addEventListener("click", () => showDefaultAccountView());
goLoginFromResetConfirm?.addEventListener("click", () => showDefaultAccountView());

authSignoutBtn?.addEventListener("click", async () => {
  await signOutCognito();
  clearCognitoIdentity();
  clearAuthFormFields();
  syncSessionFromExisting();
  showToast("Signed out.", "success");
});

fullSignoutBtn?.addEventListener("click", async () => {
  await signOutCognito();
  clearCognitoIdentity();
  clearAuthFormFields();
  localStorage.removeItem("artizans.last_mode.v1");
  syncSessionFromExisting();
  showToast("Signed out and cleared.", "success");
});

await hydrateCognitoState();

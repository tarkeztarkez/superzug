import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

const API = process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === "web" ? "" : "https://superzug.marcinszyda.com");
const ink = "#17221C";
const green = "#176B45";
const cream = "#F4F3ED";

type User = { id: string; name: string; email: string; isAdmin: boolean };
type Ticket = {
  id: string;
  status: "processing" | "ready" | "needs_review";
  train_number?: string;
  origin?: string;
  destination?: string;
  departure_at?: string;
  arrival_at?: string;
  platform?: string;
  track?: string;
  carriage?: string;
  seat?: string;
  delay_minutes: number;
  file_name: string;
  pdfUrl: string;
  codeUrl?: string;
};

const tokenStore = {
  get: () => Platform.OS === "web" ? Promise.resolve(localStorage.getItem("superzug_token")) : SecureStore.getItemAsync("superzug_token"),
  set: (value: string) => Platform.OS === "web" ? Promise.resolve(localStorage.setItem("superzug_token", value)) : SecureStore.setItemAsync("superzug_token", value),
  clear: () => Platform.OS === "web" ? Promise.resolve(localStorage.removeItem("superzug_token")) : SecureStore.deleteItemAsync("superzug_token"),
};

async function request(path: string, token: string, init?: RequestInit) {
  const response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...init?.headers } });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? "Something went wrong");
  return response;
}

function Logo() {
  return (
    <View style={styles.logo}>
      <View style={styles.logoMark}><Ionicons name="train" size={18} color="#fff" /></View>
      <Text style={styles.logoText}>superzug</Text>
    </View>
  );
}

function Login({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${API}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await tokenStore.set(data.token);
      onLogin(data.token, data.user);
    } catch (error) { Alert.alert("Couldn’t sign in", (error as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <SafeAreaView style={styles.loginPage}>
      <StatusBar style="dark" />
      <View style={styles.loginWrap}>
        <Logo />
        <View style={styles.loginArt}>
          <View style={styles.sun} />
          <View style={styles.railOne} /><View style={styles.railTwo} />
          <Ionicons name="train-outline" size={76} color={ink} style={styles.loginTrain} />
        </View>
        <Text style={styles.loginTitle}>Your journey,{"\n"}all in one place.</Text>
        <Text style={styles.loginLead}>Tickets, platforms and live delays — ready when you are.</Text>
        <TextInput style={styles.input} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor="#7E847F" />
        <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry placeholder="Password" placeholderTextColor="#7E847F" onSubmitEditing={submit} />
        <Pressable style={[styles.primaryButton, busy && styles.dim]} disabled={busy} onPress={submit}>
          {busy ? <ActivityIndicator color="#fff" /> : <><Text style={styles.primaryButtonText}>Sign in</Text><Ionicons name="arrow-forward" color="#fff" size={19} /></>}
        </Pressable>
        <Text style={styles.inviteNote}><Ionicons name="lock-closed" size={13} /> Private by invitation only</Text>
      </View>
    </SafeAreaView>
  );
}

function TicketCard({ item, onPress }: { item: Ticket; onPress: () => void }) {
  if (item.status !== "ready") return (
    <Pressable style={styles.processingCard} onPress={onPress}>
      <View style={styles.processingIcon}><Ionicons name={item.status === "processing" ? "sparkles" : "alert-circle"} size={22} color={item.status === "processing" ? green : "#A05A35"} /></View>
      <View style={styles.grow}><Text style={styles.processingTitle}>{item.status === "processing" ? "Reading your ticket…" : "Ticket needs a quick check"}</Text><Text style={styles.muted} numberOfLines={1}>{item.file_name}</Text></View>
      {item.status === "processing" ? <ActivityIndicator color={green} /> : <Ionicons name="chevron-forward" size={20} color="#737A75" />}
    </Pressable>
  );
  const departure = item.departure_at ? new Date(item.departure_at) : null;
  const arrival = item.arrival_at ? new Date(item.arrival_at) : null;
  return (
    <Pressable style={styles.ticketCard} onPress={onPress}>
      <View style={styles.ticketTop}>
        <View style={styles.trainPill}><Ionicons name="train-outline" size={14} color={green} /><Text style={styles.trainPillText}>{item.train_number || "Train"}</Text></View>
        {item.delay_minutes > 0 ? <View style={styles.delayPill}><Text style={styles.delayText}>+{item.delay_minutes} min</Text></View> : <View style={styles.onTimePill}><Text style={styles.onTimeText}>On time</Text></View>}
      </View>
      <View style={styles.routeRow}>
        <View style={styles.timeColumn}><Text style={styles.time}>{departure ? departure.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</Text><Text style={styles.station} numberOfLines={1}>{item.origin || "Origin"}</Text></View>
        <View style={styles.routeLine}><View style={styles.dot} /><View style={styles.line} /><Ionicons name="arrow-forward" size={14} color="#9AA099" /><View style={styles.line} /><View style={[styles.dot, styles.dotOpen]} /></View>
        <View style={[styles.timeColumn, styles.alignRight]}><Text style={styles.time}>{arrival ? arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</Text><Text style={[styles.station, styles.textRight]} numberOfLines={1}>{item.destination || "Destination"}</Text></View>
      </View>
      <View style={styles.ticketMeta}>
        <Text style={styles.dateText}>{departure?.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" })}</Text>
        <View style={styles.metaItems}>
          {item.platform && <Text style={styles.metaText}>Platform <Text style={styles.metaStrong}>{item.platform}</Text></Text>}
          {item.track && <Text style={styles.metaText}>Track <Text style={styles.metaStrong}>{item.track}</Text></Text>}
          {item.carriage && <Text style={styles.metaText}>Coach <Text style={styles.metaStrong}>{item.carriage}</Text></Text>}
        </View>
      </View>
    </Pressable>
  );
}

function Detail({ item, token, back, remove, retry }: { item: Ticket; token: string; back: () => void; remove: () => void; retry: () => void }) {
  const departure = item.departure_at && new Date(item.departure_at);
  const arrival = item.arrival_at && new Date(item.arrival_at);
  const openPdf = async () => {
    try {
      const blob = await (await request(item.pdfUrl, token)).blob();
      if (Platform.OS === "web") window.open(URL.createObjectURL(blob), "_blank");
      else Alert.alert("PDF ready", "The original ticket is securely stored. PDF sharing will be available in the next mobile build.");
    } catch (error) { Alert.alert("Couldn’t open PDF", (error as Error).message); }
  };
  const confirmDelete = () => {
    if (Platform.OS === "web") {
      if (window.confirm("Delete this ticket and its PDF permanently?")) remove();
      return;
    }
    Alert.alert("Delete ticket?", "The PDF will also be permanently deleted.", [{ text: "Cancel", style: "cancel" }, { text: "Delete", style: "destructive", onPress: remove }]);
  };
  return (
    <SafeAreaView style={styles.page}><StatusBar style="dark" />
      <View style={styles.detailHeader}><Pressable style={styles.roundButton} onPress={back}><Ionicons name="arrow-back" size={22} color={ink} /></Pressable><Text style={styles.detailHeaderTitle}>Ticket</Text><Pressable style={styles.roundButton} onPress={confirmDelete}><Ionicons name="trash-outline" size={20} color="#9B4A43" /></Pressable></View>
      <ScrollView contentContainerStyle={styles.detailBody}>
        <Text style={styles.detailTrain}>{item.train_number || "Train ticket"}</Text>
        <Text style={styles.detailDate}>{departure ? departure.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }) : "Journey details"}</Text>
        <View style={styles.journeyCard}>
          <View style={styles.timeline}><View style={styles.bigDot} /><View style={styles.verticalLine} /><View style={[styles.bigDot, styles.bigDotOpen]} /></View>
          <View style={styles.journeyStops}>
            <View><Text style={styles.journeyTime}>{departure ? departure.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</Text><Text style={styles.journeyStation}>{item.origin || "Origin"}</Text></View>
            <View><Text style={styles.journeyTime}>{arrival ? arrival.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</Text><Text style={styles.journeyStation}>{item.destination || "Destination"}</Text></View>
          </View>
        </View>
        <View style={styles.infoGrid}>
          {[['Platform', item.platform], ['Track', item.track], ['Coach', item.carriage], ['Seat', item.seat]].map(([label, value]) => <View style={styles.infoCell} key={label}><Text style={styles.infoLabel}>{label}</Text><Text style={styles.infoValue}>{value || "—"}</Text></View>)}
        </View>
        {item.codeUrl ? <View style={styles.codeCard}><Text style={styles.sectionTitle}>Show to inspector</Text><View style={styles.codePlaceholder}><Ionicons name="qr-code" size={130} color={ink} /></View><Text style={styles.centerMuted}>Increase screen brightness for easy scanning</Text></View> : <View style={styles.notice}><Ionicons name="information-circle-outline" size={20} color={green} /><Text style={styles.noticeText}>Use the original PDF when the conductor checks your ticket.</Text></View>}
        {item.status === "needs_review" && <Pressable style={styles.primaryButton} onPress={retry}><Ionicons name="sparkles" size={19} color="#fff" /><Text style={styles.primaryButtonText}>Analyse again</Text></Pressable>}
        <Pressable style={styles.outlineButton} onPress={openPdf}><Ionicons name="document-text-outline" size={20} color={ink} /><Text style={styles.outlineButtonText}>Open original PDF</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Settings({ user, token, logout }: { user: User; token: string; logout: () => void }) {
  const [createdToken, setCreatedToken] = useState("");
  const [invite, setInvite] = useState({ name: "", email: "", password: "" });
  const createToken = async () => {
    try {
      const data = await (await request("/api/tokens", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hermes", scopes: ["tickets:read", "tickets:write"] }) })).json();
      setCreatedToken(data.token);
    } catch (error) { Alert.alert("Couldn’t create token", (error as Error).message); }
  };
  const createUser = async () => {
    try {
      await request("/api/users", token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(invite) });
      setInvite({ name: "", email: "", password: "" });
      Alert.alert("Person added", "They can now sign in with the password you gave them.");
    } catch (error) { Alert.alert("Couldn’t add person", (error as Error).message); }
  };
  return <ScrollView contentContainerStyle={styles.settingsBody}>
    <Text style={styles.eyebrow}>ACCOUNT</Text><Text style={styles.screenTitle}>Settings</Text>
    <View style={styles.profileCard}><View style={styles.avatar}><Text style={styles.avatarText}>{user.name.slice(0, 1).toUpperCase()}</Text></View><View style={styles.grow}><Text style={styles.profileName}>{user.name}</Text><Text style={styles.muted}>{user.email}</Text></View>{user.isAdmin && <View style={styles.adminPill}><Text style={styles.adminText}>Admin</Text></View>}</View>
    <Text style={styles.settingsHeading}>Hermes access</Text><Text style={styles.settingsCopy}>Create a personal token for your agent. The full token is only shown once.</Text>
    {createdToken ? <View style={styles.tokenBox}><Text selectable style={styles.tokenText}>{createdToken}</Text><Text style={styles.tokenWarning}>Copy and save this token now.</Text></View> : <Pressable style={styles.outlineButton} onPress={createToken}><Ionicons name="key-outline" size={20} color={ink} /><Text style={styles.outlineButtonText}>Create Hermes token</Text></Pressable>}
    {user.isAdmin && <><Text style={styles.settingsHeading}>Add a person</Text><Text style={styles.settingsCopy}>Superzug has no public sign-up. Create access for someone you trust.</Text><View style={styles.inviteForm}><TextInput style={styles.input} value={invite.name} onChangeText={(name) => setInvite({ ...invite, name })} placeholder="Name" placeholderTextColor="#7E847F" /><TextInput style={styles.input} value={invite.email} onChangeText={(email) => setInvite({ ...invite, email })} autoCapitalize="none" keyboardType="email-address" placeholder="Email address" placeholderTextColor="#7E847F" /><TextInput style={styles.input} value={invite.password} onChangeText={(password) => setInvite({ ...invite, password })} secureTextEntry placeholder="Temporary password (10+ characters)" placeholderTextColor="#7E847F" /><Pressable style={styles.addPersonButton} onPress={createUser}><Ionicons name="person-add-outline" size={18} color="#fff" /><Text style={styles.primaryButtonText}>Add person</Text></Pressable></View></>}
    <View style={styles.retention}><Ionicons name="shield-checkmark-outline" size={23} color={green} /><View style={styles.grow}><Text style={styles.retentionTitle}>Automatic privacy cleanup</Text><Text style={styles.muted}>Tickets and PDFs are deleted 7 days after arrival.</Text></View></View>
    <Pressable style={styles.logoutButton} onPress={logout}><Text style={styles.logoutText}>Sign out</Text></Pressable>
  </ScrollView>;
}

export default function App() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [tab, setTab] = useState<"tickets" | "settings">("tickets");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width > 720;

  const load = async (auth = token) => {
    if (!auth) return;
    try {
      const [me, list] = await Promise.all([request("/api/me", auth), request("/api/tickets", auth)]);
      setUser(await me.json()); setTickets(await list.json()); setToken(auth);
    } catch { await tokenStore.clear(); setToken(""); setUser(null); }
    finally { setLoading(false); setRefreshing(false); }
  };
  useEffect(() => { tokenStore.get().then((saved) => saved ? load(saved) : setLoading(false)); }, []);
  useEffect(() => { if (!token || !tickets.some((item) => item.status === "processing")) return; const timer = setInterval(() => load(), 5000); return () => clearInterval(timer); }, [token, tickets]);

  const groups = useMemo(() => ({ upcoming: tickets.filter((item) => !item.arrival_at || new Date(item.arrival_at) >= new Date()), past: tickets.filter((item) => item.arrival_at && new Date(item.arrival_at) < new Date()) }), [tickets]);
  const importPdf = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ type: "application/pdf", copyToCacheDirectory: true });
    if (picked.canceled) return;
    const asset = picked.assets[0];
    const form = new FormData();
    if (Platform.OS === "web") form.append("file", asset.file!);
    else form.append("file", { uri: asset.uri, name: asset.name, type: asset.mimeType ?? "application/pdf" } as unknown as Blob);
    try { await request("/api/tickets/import", token, { method: "POST", body: form }); await load(); }
    catch (error) { Alert.alert("Couldn’t import ticket", (error as Error).message); }
  };
  const remove = async () => { if (!selected) return; try { await request(`/api/tickets/${selected.id}`, token, { method: "DELETE" }); setSelected(null); await load(); } catch (error) { Alert.alert("Couldn’t delete ticket", (error as Error).message); } };
  const logout = async () => { await tokenStore.clear(); setToken(""); setUser(null); setTickets([]); };

  if (loading) return <View style={styles.loader}><Logo /><ActivityIndicator color={green} /></View>;
  if (!user) return <Login onLogin={(value, nextUser) => { setToken(value); setUser(nextUser); load(value); }} />;
  if (selected) return <Detail item={selected} token={token} back={() => setSelected(null)} remove={remove} retry={async () => { try { await request(`/api/tickets/${selected.id}/retry`, token, { method: "POST" }); setSelected(null); await load(); } catch (error) { Alert.alert("Couldn’t analyse ticket", (error as Error).message); } }} />;

  return <SafeAreaView style={styles.page}><StatusBar style="dark" />
    <View style={[styles.shell, wide && styles.shellWide]}>
      {wide && <View style={styles.sidebar}><Logo /><Pressable style={[styles.sideItem, tab === "tickets" && styles.sideItemActive]} onPress={() => setTab("tickets")}><Ionicons name="ticket-outline" size={20} color={tab === "tickets" ? green : ink} /><Text style={styles.sideText}>My tickets</Text></Pressable><Pressable style={[styles.sideItem, tab === "settings" && styles.sideItemActive]} onPress={() => setTab("settings")}><Ionicons name="settings-outline" size={20} color={tab === "settings" ? green : ink} /><Text style={styles.sideText}>Settings</Text></Pressable></View>}
      <View style={styles.main}>
        {tab === "tickets" ? <ScrollView refreshControl={<RefreshControl refreshing={refreshing} tintColor={green} onRefresh={() => { setRefreshing(true); load(); }} />} contentContainerStyle={styles.listBody}>
          <View style={styles.topBar}>{!wide && <Logo />}<View style={styles.topActions}><Pressable style={styles.avatarSmall} onPress={() => setTab("settings")}><Text style={styles.avatarSmallText}>{user.name.slice(0, 1).toUpperCase()}</Text></Pressable></View></View>
          <View style={styles.heroRow}><View><Text style={styles.eyebrow}>GOOD TO SEE YOU, {user.name.split(" ")[0].toUpperCase()}</Text><Text style={styles.screenTitle}>Where to next?</Text></View><Pressable style={styles.addButton} onPress={importPdf}><Ionicons name="add" size={21} color="#fff" /><Text style={styles.addButtonText}>Add ticket</Text></Pressable></View>
          {groups.upcoming.length ? <><Text style={styles.sectionLabel}>UPCOMING</Text><View style={wide ? styles.cardGrid : undefined}>{groups.upcoming.map((item) => <View key={item.id} style={wide ? styles.gridItem : undefined}><TicketCard item={item} onPress={() => setSelected(item)} /></View>)}</View></> : <View style={styles.empty}><View style={styles.emptyIcon}><Ionicons name="ticket-outline" size={38} color={green} /></View><Text style={styles.emptyTitle}>No journeys yet</Text><Text style={styles.emptyCopy}>Add a train ticket PDF and we’ll organise the useful bits for you.</Text><Pressable style={styles.primaryButtonSmall} onPress={importPdf}><Text style={styles.primaryButtonText}>Choose a PDF</Text></Pressable></View>}
          {groups.past.length > 0 && <><Text style={styles.sectionLabel}>RECENT JOURNEYS</Text>{groups.past.map((item) => <TicketCard key={item.id} item={item} onPress={() => setSelected(item)} />)}</>}
        </ScrollView> : <Settings user={user} token={token} logout={logout} />}
        {!wide && <View style={styles.bottomNav}><Pressable style={styles.navItem} onPress={() => setTab("tickets")}><Ionicons name={tab === "tickets" ? "ticket" : "ticket-outline"} size={22} color={tab === "tickets" ? green : "#777D78"} /><Text style={[styles.navText, tab === "tickets" && styles.navTextActive]}>Tickets</Text></Pressable><Pressable style={styles.navItem} onPress={() => setTab("settings")}><Ionicons name={tab === "settings" ? "settings" : "settings-outline"} size={22} color={tab === "settings" ? green : "#777D78"} /><Text style={[styles.navText, tab === "settings" && styles.navTextActive]}>Settings</Text></Pressable></View>}
      </View>
    </View>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: cream }, loader: { flex: 1, backgroundColor: cream, alignItems: "center", justifyContent: "center", gap: 30 }, grow: { flex: 1 }, dim: { opacity: .65 }, muted: { color: "#757C77", fontSize: 14, lineHeight: 20 }, logo: { flexDirection: "row", alignItems: "center", gap: 9 }, logoMark: { width: 34, height: 34, borderRadius: 10, backgroundColor: green, alignItems: "center", justifyContent: "center" }, logoText: { color: ink, fontWeight: "800", fontSize: 21, letterSpacing: -.7 },
  loginPage: { flex: 1, backgroundColor: cream }, loginWrap: { width: "100%", maxWidth: 460, alignSelf: "center", padding: 28, flex: 1, justifyContent: "center" }, loginArt: { height: 135, marginTop: 38, marginBottom: 24, overflow: "hidden", position: "relative" }, sun: { position: "absolute", width: 105, height: 105, borderRadius: 60, backgroundColor: "#F2C96D", top: 8, left: "50%", marginLeft: -52 }, railOne: { position: "absolute", height: 2, width: "75%", backgroundColor: "#9CA59E", bottom: 19, left: "12%", transform: [{ rotate: "3deg" }] }, railTwo: { position: "absolute", height: 2, width: "75%", backgroundColor: "#9CA59E", bottom: 10, left: "13%", transform: [{ rotate: "3deg" }] }, loginTrain: { position: "absolute", left: "50%", marginLeft: -38, bottom: 17 }, loginTitle: { color: ink, fontSize: 39, lineHeight: 43, fontWeight: "800", letterSpacing: -1.4 }, loginLead: { color: "#626A65", fontSize: 16, lineHeight: 24, marginTop: 14, marginBottom: 28, maxWidth: 360 }, input: { height: 56, borderWidth: 1, borderColor: "#D7D9D3", backgroundColor: "#fff", color: ink, borderRadius: 14, paddingHorizontal: 17, marginBottom: 12, fontSize: 16 }, primaryButton: { height: 56, borderRadius: 14, backgroundColor: green, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 12, marginTop: 5 }, primaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" }, inviteNote: { textAlign: "center", color: "#7A817C", fontSize: 12, marginTop: 19 },
  shell: { flex: 1 }, shellWide: { flexDirection: "row", maxWidth: 1280, width: "100%", alignSelf: "center", borderLeftWidth: 1, borderRightWidth: 1, borderColor: "#E0E1DB" }, sidebar: { width: 230, backgroundColor: "#ECEBE5", padding: 28, gap: 12, borderRightWidth: 1, borderColor: "#DDDCD5" }, sideItem: { height: 48, borderRadius: 12, flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, marginTop: 14 }, sideItemActive: { backgroundColor: "#fff" }, sideText: { color: ink, fontWeight: "600" }, main: { flex: 1 }, listBody: { paddingHorizontal: 22, paddingBottom: 110, maxWidth: 980, width: "100%", alignSelf: "center" }, topBar: { height: 78, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, topActions: { marginLeft: "auto" }, avatarSmall: { width: 37, height: 37, borderRadius: 20, backgroundColor: "#DCE8DF", alignItems: "center", justifyContent: "center" }, avatarSmallText: { color: green, fontWeight: "800" }, heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 20, marginBottom: 36, gap: 15 }, eyebrow: { color: green, fontWeight: "800", fontSize: 11, letterSpacing: 1.4, marginBottom: 8 }, screenTitle: { color: ink, fontWeight: "800", fontSize: 34, letterSpacing: -1.2 }, addButton: { height: 46, paddingHorizontal: 17, borderRadius: 13, backgroundColor: green, flexDirection: "row", alignItems: "center", gap: 6 }, addButtonText: { color: "#fff", fontWeight: "700" }, sectionLabel: { color: "#6B746E", fontSize: 11, fontWeight: "800", letterSpacing: 1.3, marginBottom: 12, marginTop: 4 }, cardGrid: { flexDirection: "row", flexWrap: "wrap", gap: 16 }, gridItem: { width: "48.7%" },
  ticketCard: { backgroundColor: "#fff", borderRadius: 18, padding: 19, marginBottom: 16, borderWidth: 1, borderColor: "#E5E5DE", shadowColor: "#1B2A20", shadowOpacity: .04, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } }, ticketTop: { flexDirection: "row", justifyContent: "space-between", marginBottom: 22 }, trainPill: { backgroundColor: "#ECF4EE", paddingHorizontal: 10, height: 28, borderRadius: 8, flexDirection: "row", alignItems: "center", gap: 6 }, trainPillText: { color: green, fontSize: 12, fontWeight: "800" }, delayPill: { backgroundColor: "#FFF0DC", paddingHorizontal: 10, height: 28, justifyContent: "center", borderRadius: 8 }, delayText: { color: "#A75D24", fontSize: 12, fontWeight: "800" }, onTimePill: { backgroundColor: "#E8F4EA", paddingHorizontal: 10, height: 28, justifyContent: "center", borderRadius: 8 }, onTimeText: { color: green, fontSize: 12, fontWeight: "700" }, routeRow: { flexDirection: "row", alignItems: "center" }, timeColumn: { width: "32%" }, alignRight: { alignItems: "flex-end" }, time: { color: ink, fontSize: 25, fontWeight: "800", letterSpacing: -.8 }, station: { color: "#545D57", marginTop: 4, fontWeight: "600" }, textRight: { textAlign: "right" }, routeLine: { flex: 1, flexDirection: "row", alignItems: "center", marginHorizontal: 8 }, dot: { width: 7, height: 7, borderRadius: 5, backgroundColor: green }, dotOpen: { backgroundColor: "#fff", borderWidth: 2, borderColor: green }, line: { height: 1, backgroundColor: "#B8BDB9", flex: 1 }, ticketMeta: { borderTopWidth: 1, borderColor: "#ECECE7", marginTop: 20, paddingTop: 14, flexDirection: "row", justifyContent: "space-between" }, dateText: { color: "#747B76", fontSize: 12 }, metaItems: { flexDirection: "row", gap: 11 }, metaText: { color: "#747B76", fontSize: 12 }, metaStrong: { color: ink, fontWeight: "800" }, processingCard: { minHeight: 88, padding: 16, borderRadius: 16, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E2E4DE", flexDirection: "row", alignItems: "center", gap: 13, marginBottom: 14 }, processingIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: "#EDF4EE", alignItems: "center", justifyContent: "center" }, processingTitle: { color: ink, fontWeight: "700", marginBottom: 3 }, empty: { paddingVertical: 54, paddingHorizontal: 25, alignItems: "center", borderRadius: 20, borderWidth: 1, borderStyle: "dashed", borderColor: "#C9CEC8", backgroundColor: "rgba(255,255,255,.42)", marginBottom: 35 }, emptyIcon: { width: 74, height: 74, borderRadius: 24, backgroundColor: "#E5EFE7", alignItems: "center", justifyContent: "center" }, emptyTitle: { color: ink, fontSize: 21, fontWeight: "800", marginTop: 20 }, emptyCopy: { color: "#6D756F", textAlign: "center", lineHeight: 21, maxWidth: 310, marginTop: 8, marginBottom: 20 }, primaryButtonSmall: { backgroundColor: green, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 13 },
  bottomNav: { position: "absolute", bottom: 0, left: 0, right: 0, height: 82, paddingBottom: 13, backgroundColor: "#FBFBF8", borderTopWidth: 1, borderColor: "#E0E1DB", flexDirection: "row", justifyContent: "space-around", alignItems: "center" }, navItem: { alignItems: "center", minWidth: 90, gap: 4 }, navText: { fontSize: 11, color: "#777D78", fontWeight: "600" }, navTextActive: { color: green },
  detailHeader: { minHeight: 70, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, maxWidth: 680, width: "100%", alignSelf: "center" }, roundButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: "#E0E1DB", alignItems: "center", justifyContent: "center" }, detailHeaderTitle: { fontWeight: "800", color: ink, fontSize: 17 }, detailBody: { padding: 22, paddingBottom: 60, maxWidth: 620, width: "100%", alignSelf: "center" }, detailTrain: { color: green, fontSize: 13, fontWeight: "800", textAlign: "center", textTransform: "uppercase", letterSpacing: 1.1 }, detailDate: { textAlign: "center", fontSize: 24, color: ink, fontWeight: "800", marginTop: 7, marginBottom: 25 }, journeyCard: { backgroundColor: ink, borderRadius: 20, padding: 25, flexDirection: "row", minHeight: 205 }, timeline: { width: 25, alignItems: "center", paddingVertical: 7 }, bigDot: { width: 13, height: 13, borderRadius: 8, backgroundColor: "#80C59A" }, bigDotOpen: { backgroundColor: ink, borderColor: "#80C59A", borderWidth: 3 }, verticalLine: { flex: 1, width: 1, backgroundColor: "#5F7166" }, journeyStops: { flex: 1, justifyContent: "space-between", marginLeft: 12 }, journeyTime: { color: "#fff", fontWeight: "800", fontSize: 24 }, journeyStation: { color: "#CDD5CF", marginTop: 3, fontSize: 15 }, infoGrid: { flexDirection: "row", flexWrap: "wrap", borderRadius: 17, overflow: "hidden", borderWidth: 1, borderColor: "#E0E2DB", marginTop: 15 }, infoCell: { width: "50%", padding: 17, backgroundColor: "#fff", borderWidth: .5, borderColor: "#E7E8E3" }, infoLabel: { color: "#747B76", fontSize: 12, marginBottom: 5 }, infoValue: { color: ink, fontSize: 20, fontWeight: "800" }, codeCard: { padding: 22, borderRadius: 18, backgroundColor: "#fff", marginTop: 17, alignItems: "center", borderWidth: 1, borderColor: "#E5E5DE" }, sectionTitle: { color: ink, fontSize: 18, fontWeight: "800", alignSelf: "flex-start" }, codePlaceholder: { backgroundColor: "#fff", padding: 25, marginTop: 10 }, centerMuted: { color: "#7A817C", textAlign: "center", fontSize: 12 }, notice: { backgroundColor: "#E8F1E9", borderRadius: 14, padding: 15, flexDirection: "row", gap: 10, marginTop: 16 }, noticeText: { color: "#42574A", flex: 1, lineHeight: 20 }, outlineButton: { height: 54, borderRadius: 14, borderWidth: 1, borderColor: "#CED2CC", backgroundColor: "#fff", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9, marginTop: 15 }, outlineButtonText: { color: ink, fontWeight: "700" },
  settingsBody: { padding: 24, paddingBottom: 110, maxWidth: 680, width: "100%", alignSelf: "center" }, profileCard: { backgroundColor: "#fff", borderRadius: 17, borderWidth: 1, borderColor: "#E2E3DD", padding: 17, flexDirection: "row", alignItems: "center", gap: 13, marginTop: 26 }, avatar: { width: 50, height: 50, borderRadius: 17, backgroundColor: "#DDEBE1", alignItems: "center", justifyContent: "center" }, avatarText: { color: green, fontSize: 20, fontWeight: "800" }, profileName: { color: ink, fontWeight: "800", fontSize: 16, marginBottom: 3 }, adminPill: { backgroundColor: "#EDF4EE", borderRadius: 8, paddingVertical: 5, paddingHorizontal: 8 }, adminText: { color: green, fontSize: 11, fontWeight: "800" }, settingsHeading: { color: ink, fontSize: 18, fontWeight: "800", marginTop: 34, marginBottom: 7 }, settingsCopy: { color: "#6E7670", lineHeight: 21 }, tokenBox: { backgroundColor: ink, borderRadius: 15, padding: 17, marginTop: 15 }, tokenText: { color: "#D7F3E0", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", fontSize: 12, lineHeight: 18 }, tokenWarning: { color: "#F0C97B", fontSize: 12, marginTop: 12 }, retention: { borderRadius: 15, backgroundColor: "#E7F0E8", padding: 16, flexDirection: "row", gap: 12, marginTop: 28 }, retentionTitle: { color: ink, fontWeight: "800", marginBottom: 3 }, logoutButton: { alignItems: "center", padding: 16, marginTop: 25 }, logoutText: { color: "#9B4A43", fontWeight: "700" },
  inviteForm: { marginTop: 15 }, addPersonButton: { height: 50, borderRadius: 13, backgroundColor: green, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 9 },
});

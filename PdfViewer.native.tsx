import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { ActivityIndicator, BackHandler, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import Pdf from "react-native-pdf";

export default function PdfViewer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const [pages, setPages] = useState(0);
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { onClose(); return true; });
    return () => subscription.remove();
  }, [onClose]);
  return <SafeAreaView style={styles.page}>
    <View style={styles.header}><Pressable style={styles.back} onPress={onClose}><Ionicons name="arrow-back" size={23} color="#17221C" /></Pressable><Text style={styles.title}>Original ticket</Text><Text style={styles.pages}>{pages ? `${pages} pages` : ""}</Text></View>
    <Pdf source={{ uri, cache: true }} style={styles.pdf} trustAllCerts={false} renderActivityIndicator={() => <ActivityIndicator size="large" color="#176B45" />} onLoadComplete={setPages} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: "#F4F3ED" },
  header: { height: 64, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderColor: "#DADCD6" },
  back: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  title: { color: "#17221C", fontSize: 17, fontWeight: "800" },
  pages: { width: 55, color: "#727A74", fontSize: 11, textAlign: "right" },
  pdf: { flex: 1, backgroundColor: "#D9DAD6" },
});

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, Dimensions, TextInput, ActivityIndicator, FlatList, Modal, Image, StatusBar } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { createClient } from '@supabase/supabase-js';
import { Ionicons } from '@expo/vector-icons';
import { Slider } from '@miblanchard/react-native-slider';
import { decode } from 'base64-arraybuffer';
import { LinearGradient } from 'expo-linear-gradient';
import YoutubePlayer from 'react-native-youtube-iframe';

const { width, height } = Dimensions.get('window');

// Supabase Setup
const supabaseUrl = 'https://zfalrfysnauagygfhpgm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpmYWxyZnlzbmF1YWd5Z2ZocGdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNTM0MjMsImV4cCI6MjA4OTkyOTQyM30.NLHZWVfDW5EXVqrSCFaB_Z8bnxONnd0179XzwGg1wXk';
const supabase = createClient(supabaseUrl, supabaseKey);

const COLORS = {
  primary: '#F8FAFC',
  secondary: '#38BDF8',
  accent: '#818CF8',
  background: '#020617',
  card: '#0F172A',
  text: '#F1F5F9',
  muted: '#64748B'
};

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
  );
}

function MainApp() {
  const [playlist, setPlaylist] = useState([]);
  const [filterMode, setFilterMode] = useState('all');
  const [currentTrackIndex, setCurrentTrackIndex] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [isFullPlayerVisible, setIsFullPlayerVisible] = useState(false);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(1);
  const [isLooping, setIsLooping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [ytReady, setYtReady] = useState(false); // 1. Readiness State

  const currentTrack = currentTrackIndex !== null && playlist[currentTrackIndex] ? playlist[currentTrackIndex] : null;
  const isYoutube = currentTrack && !currentTrack.url.includes('supabase.co');
  const filteredPlaylist = filterMode === 'favorites' ? playlist.filter(s => s.is_favorite) : playlist;

  const audioPlayer = useAudioPlayer(currentTrack && !isYoutube ? { uri: currentTrack.url, shouldPlay: true } : null);
  const audioStatus = useAudioPlayerStatus(audioPlayer);
  const ytRef = useRef(null);
  const isPolling = useRef(false);

  // Unified Playback Sync (Local)
  useEffect(() => {
    if (!isYoutube && audioStatus) {
      if (audioStatus.playing !== isPlaying) setIsPlaying(audioStatus.playing);
      setCurrentTime(audioStatus.currentTime || 0);
      setDuration(audioStatus.duration || 1);
      if (audioStatus.didJustFinish && !isLooping) handleNext();
    }
  }, [audioStatus, isYoutube, isLooping]);

  useEffect(() => {
    if (audioPlayer) {
      audioPlayer.volume = isMuted ? 0 : 1;
      audioPlayer.loop = isLooping;
    }
  }, [audioPlayer, isMuted, isLooping]);

  // 3. Control effect: Synchronize isPlaying with Player
  useEffect(() => {
    if (isYoutube && ytRef.current && ytReady) {
      if (isPlaying) {
        ytRef.current.playVideo?.();
      } else {
        ytRef.current.pauseVideo?.();
      }
    }
  }, [isPlaying, ytReady, isYoutube]);

  // 5. Fix onChangeState (Ended Only)
  const onYtStateChange = useCallback((state) => {
    if (state === "ended" && !isLooping) handleNext();
    // 6. DO NOT update isPlaying here to avoid conflicts
  }, [isLooping]);

  // 2. Update onReady handler
  const onYtReady = useCallback(() => {
    setYtReady(true);
    setIsPlaying(true);
    setTimeout(() => {
      ytRef.current?.seekTo(0, true);
    }, 300);
  }, []);

  const onYtError = useCallback(() => {
    handleNext();
  }, []);

  // Track YouTube Time (Lock-Protected Polling)
  useEffect(() => {
    let interval;
    const updateProgress = async () => {
      if (ytRef.current && isYoutube && isPlaying && !isPolling.current) {
        isPolling.current = true;
        try {
          const time = await ytRef.current.getCurrentTime();
          const dur = await ytRef.current.getDuration();
          if (time != null) setCurrentTime(time);
          if (dur != null) setDuration(dur || 1);
        } catch (e) {
        } finally {
          isPolling.current = false;
        }
      }
    };
    if (isYoutube && isPlaying) interval = setInterval(updateProgress, 1000);
    return () => { if (interval) clearInterval(interval); isPolling.current = false; };
  }, [isYoutube, isPlaying]);

  useEffect(() => {
    (async () => {
      try {
        await setAudioModeAsync({ shouldPlayInBackground: true, playsInSilentMode: true, interruptionMode: 'mixWithOthers' });
        await fetchSongs();
      } catch (e) { }
    })();
    return () => { isPolling.current = false; };
  }, []);

  const fetchSongs = async () => {
    const { data } = await supabase.from('songs').select('*').order('position', { ascending: true });
    if (data) setPlaylist(data);
  };

  const decodeHTMLEntities = (text) => {
    if (!text) return "";
    return text.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  };

  const searchYouTube = async () => {
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setSearchResults([]);
    try {
      const response = await fetch(`https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36' }
      });
      const html = await response.text();
      const ids = [...new Set(html.match(/"videoId":"([^"]+)"/g))].slice(0, 8).map(v => v.split('"')[3]);

      const results = ids.map(id => {
        const block = html.substring(html.indexOf(`"videoId":"${id}"`), html.indexOf(`"videoId":"${id}"`) + 2000);
        const titleMatch = block.match(/"title":\{"runs":\[\{"text":"(.*?)"\}/);
        const artistMatch = block.match(/"longBylineText":\{"runs":\[\{"text":"(.*?)"\}/);
        return {
          id: id,
          title: decodeHTMLEntities(titleMatch ? titleMatch[1] : "Discovery"),
          artist: decodeHTMLEntities(artistMatch ? artistMatch[1] : "YouTube Mix"),
          thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
        };
      });
      setSearchResults(results.filter(r => r.id));
    } catch (e) { } finally { setIsSearching(false); }
  };

  const selectTrack = (index) => {
    if (currentTrackIndex === index) {
      setIsFullPlayerVisible(true);
      return;
    }
    // 4. Reset readiness when track changes
    setYtReady(false);
    setIsPlaying(false);
    setCurrentTrackIndex(null);
    setCurrentTime(0);
    setTimeout(() => {
      setCurrentTrackIndex(index);
    }, 300);
  };

  const addToLibrary = async (song) => {
    setIsSearching(true);
    try {
      const { data, error } = await supabase.from('songs').insert([{ name: song.title, artist: song.artist, url: song.id, position: playlist.length, is_favorite: false }]).select();
      if (!error && data) {
        const updatedPlaylist = [...playlist, data[0]];
        setPlaylist(updatedPlaylist);
        setShowSearch(false);
        selectTrack(updatedPlaylist.length - 1);
        setIsFullPlayerVisible(true);
      }
    } catch (e) { } finally { setIsSearching(false); }
  };

  const toggleFavorite = async (song) => {
    const status = !song.is_favorite;
    const { error } = await supabase.from('songs').update({ is_favorite: status }).eq('id', song.id);
    if (!error) setPlaylist(playlist.map(s => s.id === song.id ? { ...s, is_favorite: status } : s));
  };

  const deleteSong = async (song) => {
    if (song.url.includes('supabase.co')) {
      const path = song.url.split('/').pop();
      await supabase.storage.from('songs').remove([path]);
    }
    await supabase.from('songs').delete().eq('id', song.id);
    await fetchSongs();
  };

  const handlePlayPause = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState); // Master State Control
    if (!isYoutube && audioPlayer) {
      nextState ? audioPlayer.play() : audioPlayer.pause();
    }
  };

  const handleNext = () => {
    if (filteredPlaylist.length > 0) {
      const currentFilteredIndex = filteredPlaylist.findIndex(s => s.id === currentTrack?.id);
      const nextFilteredIndex = (currentFilteredIndex + 1) % filteredPlaylist.length;
      const nextGlobalIndex = playlist.findIndex(s => s.id === filteredPlaylist[nextFilteredIndex].id);
      selectTrack(nextGlobalIndex);
    }
  };

  const handlePrevious = () => {
    if (filteredPlaylist.length > 0) {
      const currentFilteredIndex = filteredPlaylist.findIndex(s => s.id === currentTrack?.id);
      const prevFilteredIndex = (currentFilteredIndex - 1 + filteredPlaylist.length) % filteredPlaylist.length;
      const prevGlobalIndex = playlist.findIndex(s => s.id === filteredPlaylist[prevFilteredIndex].id);
      selectTrack(prevGlobalIndex);
    }
  };

  const pickAudio = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
      if (!res.canceled && res.assets?.[0]) {
        setIsUploading(true);
        const file = res.assets[0];
        const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
        const name = file.name || "Track";
        const path = `${Date.now()}-${name.replace(/ /g, '_')}`;
        await supabase.storage.from('songs').upload(path, decode(base64), { contentType: 'audio/mpeg' });
        const { data } = supabase.storage.from('songs').getPublicUrl(path);
        await supabase.from('songs').insert([{ name, artist: "My Tracks", url: data.publicUrl, position: playlist.length }]);
        await fetchSongs();
        setIsUploading(false);
      }
    } catch (e) { setIsUploading(false); }
  };

  const formatTime = (s) => {
    if (!s) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' : ''}${sec}`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={{ position: 'absolute', top: -height * 2, left: -width * 2, width: 1, height: 1, opacity: 0 }} pointerEvents="none">
        {isYoutube && (
          <YoutubePlayer
            key={currentTrack?.url + currentTrackIndex}
            ref={ytRef}
            height={1} width={1}
            play={isPlaying}
            mute={isMuted}
            videoId={currentTrack.url}
            onChangeState={onYtStateChange}
            onReady={onYtReady}
            onError={onYtError}
            initialPlayerParams={{ controls: false, rel: false, iv_load_policy: 3 }}
          />
        )}
      </View>

      <LinearGradient colors={[COLORS.card, COLORS.background]} style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerSubtitle}>CLOUD PLAYER PRO</Text>
          <Text style={styles.headerTitle}>{showSearch ? "Search" : (filterMode === 'favorites' ? "Loved Mix" : "Midnight Mix")}</Text>
        </View>
        <View style={styles.headerIcons}>
          <TouchableOpacity style={styles.iconCircle} onPress={() => setShowSearch(!showSearch)}><Ionicons name={showSearch ? "close" : "search"} size={22} color={COLORS.text} /></TouchableOpacity>
          <TouchableOpacity style={[styles.premiumAddButton, { backgroundColor: COLORS.secondary }]} onPress={pickAudio}><Ionicons name="add" size={24} color="#000" /></TouchableOpacity>
        </View>
      </LinearGradient>

      {!showSearch && (
        <View style={styles.filterRow}>
          <TouchableOpacity onPress={() => setFilterMode('all')} style={[styles.filterBtn, filterMode === 'all' && styles.filterBtnActive]}><Text style={[styles.filterText, filterMode === 'all' && styles.filterTextActive]}>Library</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setFilterMode('favorites')} style={[styles.filterBtn, filterMode === 'favorites' && styles.filterBtnActive]}><Text style={[styles.filterText, filterMode === 'favorites' && styles.filterTextActive]}>Favorites</Text></TouchableOpacity>
        </View>
      )}

      {showSearch && (
        <View style={styles.searchSection}>
          <View style={styles.searchBar}>
            <TextInput style={styles.searchInput} placeholder="Search tracks..." placeholderTextColor={COLORS.muted} value={searchQuery} onChangeText={setSearchQuery} onSubmitEditing={searchYouTube} />
            <TouchableOpacity onPress={searchYouTube}><Ionicons name="play-circle" size={32} color={COLORS.secondary} /></TouchableOpacity>
          </View>
          {isSearching ? <ActivityIndicator color={COLORS.secondary} style={{ marginTop: 10 }} /> : (
            <FlatList data={searchResults} keyExtractor={(item, index) => item.id || index.toString()} renderItem={({ item }) => (
              <TouchableOpacity style={styles.searchResultItem} onPress={() => addToLibrary(item)}>
                <Image source={{ uri: item.thumbnail }} style={{ width: 45, height: 45, borderRadius: 8 }} />
                <View style={{ flex: 1, marginLeft: 15 }}><Text style={styles.searchResultText} numberOfLines={1}>{item.title}</Text><Text style={styles.searchResultArtist}>{item.artist}</Text></View>
                <Ionicons name="add-circle" size={28} color={COLORS.secondary} />
              </TouchableOpacity>
            )} style={{ maxHeight: 280 }} />
          )}
        </View>
      )}

      <View style={{ flex: 1 }}>
        {filteredPlaylist.length === 0 ? (
          <View style={styles.empty}><Ionicons name="disc-outline" size={80} color={COLORS.card} /><Text style={styles.emptyText}>{filterMode === 'favorites' ? "No favorites yet" : "Library is empty"}</Text></View>
        ) : (
          <FlatList data={filteredPlaylist} keyExtractor={(item) => item.id.toString()} renderItem={({ item, index }) => {
            const globalIndex = playlist.findIndex(p => p.id === item.id);
            const active = currentTrackIndex === globalIndex;
            const isLocal = item.url.includes('supabase.co');
            return (
              <View style={[styles.trackItem, active && styles.activeItem]}>
                <TouchableOpacity style={styles.trackContent} onPress={() => selectTrack(globalIndex)}>
                  <View style={[styles.trackIcon, active && { backgroundColor: COLORS.secondary }]}>
                    <Ionicons name={isLocal ? "cloud" : "logo-youtube"} size={22} color={active ? "#000" : COLORS.muted} />
                  </View>
                  <View style={styles.trackInfo}>
                    <Text style={[styles.trackName, active && { color: COLORS.secondary }]} numberOfLines={1}>{item.name?.split('"')[0]}</Text>
                    <Text style={styles.trackArtist}>{isLocal ? "Cloud Track" : item.artist?.split('"')[0]}</Text>
                  </View>
                </TouchableOpacity>
                <View style={styles.reorder}>
                  <TouchableOpacity onPress={() => toggleFavorite(item)}><Ionicons name={item.is_favorite ? "heart" : "heart-outline"} size={22} color={item.is_favorite ? COLORS.secondary : COLORS.muted} /></TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteSong(item)} style={{ marginLeft: 15 }}><Ionicons name="trash-outline" size={20} color="#FF4D4D" /></TouchableOpacity>
                </View>
              </View>
            );
          }} contentContainerStyle={styles.playlist} />
        )}
      </View>

      {currentTrack && (
        <TouchableOpacity style={styles.miniPlayer} onPress={() => setIsFullPlayerVisible(true)}>
          <View style={styles.miniContent}>
            <Image source={{ uri: isYoutube ? `https://i.ytimg.com/vi/${currentTrack.url}/default.jpg` : 'https://cdn-icons-png.flaticon.com/512/3844/3844724.png' }} style={styles.miniArt} />
            <View style={{ marginLeft: 12, flex: 1 }}><Text style={styles.miniName} numberOfLines={1}>{currentTrack.name?.split('"')[0]}</Text><Text style={styles.miniArtist} numberOfLines={1}>{currentTrack.artist?.split('"')[0]}</Text></View>
            <TouchableOpacity onPress={(e) => { e.stopPropagation(); handlePlayPause(); }} style={styles.miniPlayBtn}><Ionicons name={isPlaying ? "pause" : "play"} size={28} color={COLORS.text} /></TouchableOpacity>
          </View>
          <View style={styles.progress}><View style={[styles.fill, { backgroundColor: COLORS.secondary, width: `${(currentTime / (duration || 1)) * 100}%` }]} /></View>
        </TouchableOpacity>
      )}

      <Modal visible={isFullPlayerVisible} animationType="slide">
        <SafeAreaView style={styles.full}>
          <LinearGradient colors={[COLORS.card, COLORS.background]} style={{ flex: 1, paddingHorizontal: 30 }}>
            <View style={styles.fullHeader}><TouchableOpacity onPress={() => setIsFullPlayerVisible(false)}><Ionicons name="chevron-down" size={32} color={COLORS.text} /></TouchableOpacity><Text style={styles.fullTitle}>NOW PLAYING</Text><Ionicons name="ellipsis-horizontal" size={24} color={COLORS.text} /></View>
            <View style={styles.fullArt}>
              <Image source={{ uri: isYoutube ? `https://i.ytimg.com/vi/${currentTrack.url}/hqdefault.jpg` : 'https://cdn-icons-png.flaticon.com/512/3844/3844724.png' }} style={[styles.largeArt, isPlaying && { borderColor: COLORS.secondary, borderWidth: 1 }]} />
            </View>
            <View style={styles.titleRow}>
              <View style={{ flex: 1 }}><Text style={styles.fullName} numberOfLines={1}>{currentTrack?.name?.split('"')[0]}</Text><Text style={styles.fullArtist} numberOfLines={1}>{currentTrack?.artist?.split('"')[0]}</Text></View>
              <TouchableOpacity onPress={() => toggleFavorite(currentTrack)}><Ionicons name={currentTrack?.is_favorite ? "heart" : "heart-outline"} size={32} color={currentTrack?.is_favorite ? COLORS.secondary : COLORS.text} /></TouchableOpacity>
            </View>
            <View style={{ marginBottom: 30 }}>
              <Slider value={currentTime || 0} minimumValue={0} maximumValue={duration || 1} onSlidingComplete={(val) => { if (isYoutube) ytRef.current?.seekTo(val[0]); else audioPlayer?.seekTo(val[0]); }} minimumTrackTintColor={COLORS.secondary} maximumTrackTintColor={COLORS.card} thumbTintColor="#FFF" trackStyle={{ height: 4 }} thumbStyle={{ width: 12, height: 12 }} />
              <View style={styles.timeRow}><Text style={styles.timeText}>{formatTime(currentTime)}</Text><Text style={styles.timeText}>{formatTime(duration)}</Text></View>
            </View>
            <View style={styles.controls}><TouchableOpacity onPress={() => setIsLooping(!isLooping)}><Ionicons name="repeat" size={26} color={isLooping ? COLORS.secondary : COLORS.text} /></TouchableOpacity><TouchableOpacity onPress={handlePrevious}><Ionicons name="play-skip-back" size={40} color={COLORS.text} /></TouchableOpacity><TouchableOpacity style={[styles.bigPlay, { backgroundColor: COLORS.text }]} onPress={handlePlayPause}><Ionicons name={isPlaying ? "pause" : "play"} size={45} color={COLORS.background} /></TouchableOpacity><TouchableOpacity onPress={handleNext}><Ionicons name="play-skip-forward" size={40} color={COLORS.text} /></TouchableOpacity><TouchableOpacity onPress={() => setIsMuted(!isMuted)}><Ionicons name={isMuted ? "volume-mute" : "volume-high"} size={26} color={COLORS.text} /></TouchableOpacity></View>
            <View style={styles.volRow}><Ionicons name="volume-low" size={20} color={COLORS.muted} /><View style={{ flex: 1, marginHorizontal: 15 }}><Slider value={isMuted ? 0 : 1} minimumValue={0} maximumValue={1} disabled={true} minimumTrackTintColor={COLORS.secondary} maximumTrackTintColor={COLORS.card} thumbTintColor="transparent" trackStyle={{ height: 4 }} /></View><Ionicons name="volume-high" size={20} color={COLORS.muted} /></View>
          </LinearGradient>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 25, paddingTop: 30, paddingBottom: 20 },
  headerSubtitle: { color: COLORS.muted, fontSize: 10, fontWeight: 'bold', letterSpacing: 2 },
  headerTitle: { color: COLORS.text, fontSize: 32, fontWeight: 'bold' },
  headerIcons: { flexDirection: 'row', alignItems: 'center' },
  iconCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: COLORS.card, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  premiumAddButton: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  filterRow: { flexDirection: 'row', paddingHorizontal: 20, marginBottom: 15 },
  filterBtn: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 12, backgroundColor: COLORS.card, marginRight: 10 },
  filterBtnActive: { backgroundColor: 'rgba(56, 189, 248, 0.15)', borderWidth: 1, borderColor: COLORS.secondary },
  filterText: { color: COLORS.muted, fontSize: 13, fontWeight: 'bold' },
  filterTextActive: { color: COLORS.secondary },
  searchSection: { paddingHorizontal: 20, paddingBottom: 15 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.card, borderRadius: 12, paddingHorizontal: 15, height: 55, marginBottom: 10 },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 15 },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.05)' },
  searchResultText: { color: COLORS.text, fontSize: 15, fontWeight: 'bold' },
  searchResultArtist: { color: COLORS.muted, fontSize: 12 },
  playlist: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 100 },
  trackItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 12, borderRadius: 16, marginBottom: 12, backgroundColor: COLORS.card },
  activeItem: { borderColor: COLORS.secondary, borderWidth: 1 },
  trackContent: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  trackIcon: { width: 40, height: 40, backgroundColor: 'rgba(255,255,255,0.02)', borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 15 },
  trackInfo: { flex: 1 },
  trackName: { color: COLORS.text, fontSize: 15, fontWeight: 'bold' },
  trackArtist: { color: COLORS.muted, fontSize: 12, marginTop: 4 },
  reorder: { flexDirection: 'row', alignItems: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', opacity: 0.5 },
  emptyText: { color: COLORS.text, fontSize: 18, fontWeight: 'bold', marginTop: 20 },
  miniPlayer: { position: 'absolute', bottom: 15, left: 15, right: 15, backgroundColor: COLORS.card, borderRadius: 20, overflow: 'hidden', height: 75, elevation: 15 },
  miniContent: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, flex: 1 },
  miniArt: { width: 48, height: 48, borderRadius: 12 },
  miniName: { color: COLORS.text, fontSize: 14, fontWeight: 'bold' },
  miniArtist: { color: COLORS.muted, fontSize: 12 },
  miniPlayBtn: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  progress: { height: 3, backgroundColor: 'rgba(255,255,255,0.05)', width: '100%' },
  fill: { height: 3 },
  full: { flex: 1, backgroundColor: COLORS.background },
  fullHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 20 },
  fullTitle: { color: COLORS.muted, fontSize: 12, fontWeight: 'bold', letterSpacing: 2 },
  fullArt: { alignItems: 'center', justifyContent: 'center', marginVertical: 60 },
  largeArt: { width: width * 0.8, height: width * 0.8, borderRadius: 32, backgroundColor: COLORS.card },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 40 },
  fullName: { color: COLORS.text, fontSize: 28, fontWeight: 'bold' },
  fullArtist: { color: COLORS.muted, fontSize: 18, marginTop: 8 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  timeText: { color: COLORS.muted, fontSize: 12, fontWeight: '500' },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 },
  bigPlay: { width: 90, height: 90, borderRadius: 45, justifyContent: 'center', alignItems: 'center' },
  volRow: { flexDirection: 'row', alignItems: 'center', opacity: 1 },
});

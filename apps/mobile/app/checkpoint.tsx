import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { supabase } from '@/lib/supabase';
import { identityFromSession } from '@/tracking/session';
import { getCurrentPosition } from '@/tracking/position';

/**
 * Tag an inspection checkpoint at the guard's current GPS position.
 *
 * Reads the current position, then calls the server-authoritative
 * `tag_checkpoint(p_site, p_lat, p_lon, p_label)` RPC — the server stamps
 * guard_id and emits a realtime.send so both maps render it. The guard's site
 * is resolved from the session's app_metadata.
 */
type Tagged = { label: string; at: number };

export default function CheckpointScreen() {
  const [label, setLabel] = useState('');
  const [siteId, setSiteId] = useState<string | null>(null);
  const [tagged, setTagged] = useState<Tagged[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSiteId(identityFromSession(data.session)?.siteIds[0] ?? null);
    });
  }, []);

  async function tag() {
    setError(null);
    if (!siteId) {
      setError('You are not assigned to a site. Ask your supervisor.');
      return;
    }
    setBusy(true);
    try {
      const pos = await getCurrentPosition();
      const trimmed = label.trim();
      const { error: e } = await supabase.rpc('tag_checkpoint', {
        p_site: siteId,
        p_lat: pos.lat,
        p_lon: pos.lon,
        p_label: trimmed || undefined,
      });
      if (e) {
        setError(e.message);
        return;
      }
      setTagged((prev) => [
        { label: trimmed || `Checkpoint ${prev.length + 1}`, at: Date.now() },
        ...prev,
      ]);
      setLabel('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read your position.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Tag a checkpoint</Text>
      <Text style={styles.sub}>Mark a point you’ve inspected at your current position.</Text>

      <TextInput
        style={styles.input}
        placeholder="Label (optional) — e.g. Loading dock door"
        value={label}
        onChangeText={setLabel}
        editable={!busy}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.button} disabled={busy} onPress={tag}>
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Tag here</Text>
        )}
      </Pressable>

      <View style={styles.list}>
        {tagged.length === 0 ? (
          <Text style={styles.empty}>No checkpoints tagged yet.</Text>
        ) : (
          tagged.map((t) => (
            <View key={t.at} style={styles.row}>
              <Text style={styles.rowText}>{t.label}</Text>
              <Text style={styles.rowMeta}>tagged</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12 },
  heading: { fontSize: 22, fontWeight: '700' },
  sub: { color: '#666', fontSize: 14, marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  error: { color: '#dc2626', fontSize: 14 },
  button: {
    backgroundColor: '#1d4ed8',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  list: { marginTop: 12, gap: 8 },
  empty: { color: '#999', fontStyle: 'italic' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#eee',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowText: { fontSize: 15 },
  rowMeta: { color: '#9ca3af', fontSize: 12 },
});

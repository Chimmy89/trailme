import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

/**
 * Tag-inspection-checkpoint shell (M0).
 *
 * In M4 this captures the guard's current position + an optional label and
 * inserts an inspection_checkpoint (server-authoritative; the server stamps
 * guard_id and emits a realtime.send so both maps render it). No insert or
 * geolocation read happens yet — this only collects the label locally.
 */
export default function CheckpointScreen() {
  const [label, setLabel] = useState('');
  const [tagged, setTagged] = useState<string[]>([]);

  function tag() {
    const trimmed = label.trim();
    setTagged((prev) => [trimmed || `Checkpoint ${prev.length + 1}`, ...prev]);
    setLabel('');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Tag a checkpoint</Text>
      <Text style={styles.sub}>
        Mark a point you’ve inspected. Position capture + sync land in M4.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Label (optional) — e.g. Loading dock door"
        value={label}
        onChangeText={setLabel}
      />

      <Pressable style={styles.button} onPress={tag}>
        <Text style={styles.buttonText}>Tag here</Text>
      </Pressable>

      <View style={styles.list}>
        {tagged.length === 0 ? (
          <Text style={styles.empty}>No checkpoints tagged yet.</Text>
        ) : (
          tagged.map((t, i) => (
            <View key={`${t}-${i}`} style={styles.row}>
              <Text style={styles.rowText}>{t}</Text>
              <Text style={styles.rowMeta}>local only</Text>
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

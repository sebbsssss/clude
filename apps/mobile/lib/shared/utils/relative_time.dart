String relativeTime(String isoTimestamp) {
  final parsed = DateTime.tryParse(isoTimestamp);
  if (parsed == null) return '';

  final now = DateTime.now();
  final diff = now.difference(parsed.toLocal());

  if (diff.inMinutes < 1) return 'Just now';
  if (diff.inMinutes < 60) return '${diff.inMinutes}m ago';
  if (diff.inHours < 24) return '${diff.inHours}h ago';
  if (diff.inDays < 30) return '${diff.inDays}d ago';

  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return '${months[parsed.month - 1]} ${parsed.day}';
}

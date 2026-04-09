import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'byok_provider.dart';

class ByokScreen extends ConsumerWidget {
  const ByokScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final keys = ref.watch(byokKeysNotifierProvider);
    final colorScheme = Theme.of(context).colorScheme;
    final configured = keys.length;

    return Scaffold(
      appBar: AppBar(title: const Text('API Keys (BYOK)')),
      body: ListView(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
            child: Text(
              'Bring your own API keys to use additional models. '
              'Keys are stored securely on-device and sent to our server only when needed.',
              style: TextStyle(
                fontSize: 13,
                color: colorScheme.onSurface.withAlpha(150),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
            child: Text(
              '$configured of ${byokProviders.length} providers configured',
              style: TextStyle(
                fontSize: 12,
                color: colorScheme.primary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ),
          ...byokProviders.map((provider) {
            final hasKey = keys.containsKey(provider);
            return _ProviderTile(
              provider: provider,
              hasKey: hasKey,
            );
          }),
        ],
      ),
    );
  }
}

class _ProviderTile extends ConsumerWidget {
  const _ProviderTile({required this.provider, required this.hasKey});

  final String provider;
  final bool hasKey;

  String get _displayName {
    switch (provider) {
      case 'anthropic':
        return 'Anthropic';
      case 'openai':
        return 'OpenAI';
      case 'google':
        return 'Google AI';
      case 'xai':
        return 'xAI';
      case 'deepseek':
        return 'DeepSeek';
      case 'minimax':
        return 'MiniMax';
      default:
        return provider;
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;

    return ListTile(
      leading: Icon(
        hasKey ? Icons.vpn_key : Icons.vpn_key_off_outlined,
        color: hasKey ? colorScheme.primary : colorScheme.onSurface.withAlpha(80),
        size: 22,
      ),
      title: Text(_displayName),
      subtitle: Text(
        hasKey ? 'Configured' : 'Not configured',
        style: TextStyle(
          fontSize: 12,
          color: hasKey
              ? colorScheme.primary
              : colorScheme.onSurface.withAlpha(100),
        ),
      ),
      trailing: hasKey
          ? IconButton(
              icon: Icon(Icons.delete_outline, color: colorScheme.error, size: 20),
              onPressed: () => _confirmRemove(context, ref),
            )
          : TextButton(
              onPressed: () => _showAddDialog(context, ref),
              child: const Text('Add'),
            ),
      onTap: hasKey ? null : () => _showAddDialog(context, ref),
    );
  }

  void _showAddDialog(BuildContext context, WidgetRef ref) {
    final controller = TextEditingController();
    final prefix = byokPrefixHints[provider] ?? '';
    String? error;

    showDialog(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, setState) => AlertDialog(
          title: Text('Add $_displayName Key'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              TextField(
                controller: controller,
                obscureText: true,
                decoration: InputDecoration(
                  hintText: '$prefix...',
                  errorText: error,
                  border: const OutlineInputBorder(),
                ),
                onChanged: (_) {
                  if (error != null) setState(() => error = null);
                },
              ),
              const SizedBox(height: 8),
              GestureDetector(
                onTap: () {
                  final url = byokDocsUrls[provider];
                  if (url != null) launchUrl(Uri.parse(url));
                },
                child: Text(
                  'Get your API key →',
                  style: TextStyle(
                    fontSize: 12,
                    color: Theme.of(context).colorScheme.primary,
                    decoration: TextDecoration.underline,
                  ),
                ),
              ),
            ],
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Cancel'),
            ),
            FilledButton(
              onPressed: () {
                final key = controller.text.trim();
                if (!validateByokKeyFormat(provider, key)) {
                  setState(() => error = 'Key should start with "$prefix"');
                  return;
                }
                ref.read(byokKeysNotifierProvider.notifier).setKey(provider, key);
                Navigator.of(dialogContext).pop();
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  void _confirmRemove(BuildContext context, WidgetRef ref) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Remove $_displayName Key?'),
        content: const Text('You can add it again later.'),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () {
              ref.read(byokKeysNotifierProvider.notifier).removeKey(provider);
              Navigator.of(dialogContext).pop();
            },
            child: const Text('Remove'),
          ),
        ],
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../core/api/models/chat_model.dart';
import '../../../core/auth/auth_provider.dart';
import '../../byok/byok_provider.dart';
import '../models_provider.dart';

class ModelSelectorSheet extends ConsumerStatefulWidget {
  const ModelSelectorSheet({super.key});

  @override
  ConsumerState<ModelSelectorSheet> createState() => _ModelSelectorSheetState();
}

class _ModelSelectorSheetState extends ConsumerState<ModelSelectorSheet> {
  @override
  void initState() {
    super.initState();
    ref.read(modelsNotifierProvider.notifier).fetchModels().then((models) {
      ref.read(selectedModelNotifierProvider.notifier).resolveDefault(models);
    }).catchError((_) {});
  }

  @override
  Widget build(BuildContext context) {
    final modelsAsync = ref.watch(modelsNotifierProvider);
    final selectedId = ref.watch(selectedModelNotifierProvider);
    final isAuthed = ref.watch(authNotifierProvider).isAuthenticated;
    final byokKeys = ref.watch(byokKeysNotifierProvider);
    final colorScheme = Theme.of(context).colorScheme;

    return DraggableScrollableSheet(
      initialChildSize: 0.6,
      minChildSize: 0.3,
      maxChildSize: 0.85,
      expand: false,
      builder: (context, scrollController) => Column(
        children: [
          const SizedBox(height: 8),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: colorScheme.onSurface.withAlpha(60),
              borderRadius: BorderRadius.circular(2),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Choose Model',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          Expanded(
            child: modelsAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('Failed to load models',
                        style: TextStyle(color: colorScheme.error)),
                    const SizedBox(height: 8),
                    ElevatedButton(
                      onPressed: () =>
                          ref.read(modelsNotifierProvider.notifier).fetchModels(),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
              data: (models) {
                final privateModels = models
                    .where((m) => m.privacy == 'private' && !m.requiresByok)
                    .toList();
                final anonModels = models
                    .where((m) => m.privacy == 'anonymized' && !m.requiresByok)
                    .toList();
                final byokModels = models
                    .where((m) => m.requiresByok)
                    .toList();

                return ListView(
                  controller: scrollController,
                  children: [
                    if (privateModels.isNotEmpty) ...[
                      _SectionHeader(
                        icon: Icons.shield_outlined,
                        label: 'Private — Zero Data Retention',
                      ),
                      ...privateModels.map((m) => _ModelRow(
                            model: m,
                            isSelected: m.id == selectedId,
                            isAuthed: isAuthed,
                          )),
                    ],
                    if (anonModels.isNotEmpty) ...[
                      _SectionHeader(
                        icon: Icons.visibility_off_outlined,
                        label: 'Anonymized — No Identity Attached',
                      ),
                      ...anonModels.map((m) => _ModelRow(
                            model: m,
                            isSelected: m.id == selectedId,
                            isAuthed: isAuthed,
                          )),
                    ],
                    if (byokModels.isNotEmpty && isAuthed) ...[
                      _SectionHeader(
                        icon: Icons.vpn_key_outlined,
                        label: 'Bring Your Own Key',
                      ),
                      ...byokModels.map((m) => _ModelRow(
                            model: m,
                            isSelected: m.id == selectedId,
                            isAuthed: isAuthed,
                            hasByokKey: byokKeys.containsKey(m.byokProvider),
                          )),
                    ],
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.icon, required this.label});

  final IconData icon;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 4),
      child: Row(
        children: [
          Icon(icon, size: 16, color: colorScheme.primary),
          const SizedBox(width: 8),
          Text(
            label,
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: colorScheme.onSurface.withAlpha(150),
                ),
          ),
        ],
      ),
    );
  }
}

class _ModelRow extends ConsumerWidget {
  const _ModelRow({
    required this.model,
    required this.isSelected,
    required this.isAuthed,
    this.hasByokKey = true,
  });

  final ChatModel model;
  final bool isSelected;
  final bool isAuthed;
  final bool hasByokKey;

  String get _costLabel {
    if (model.requiresByok) return 'Your API key';
    if (model.cost.input == 0) return 'Free';
    final perMsg = (model.cost.input + model.cost.output) * 0.0005;
    return '~\$${perMsg.toStringAsFixed(4)}/msg';
  }

  String get _contextLabel => '${(model.context / 1000).round()}K ctx';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final colorScheme = Theme.of(context).colorScheme;
    final isLocked = (model.tier == 'pro' && !isAuthed) ||
        (model.requiresByok && !hasByokKey);

    return ListTile(
      title: Row(
        children: [
          Flexible(
            child: Text(
              model.name,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          if (isLocked) ...[
            const SizedBox(width: 6),
            Icon(Icons.lock_outline, size: 14, color: colorScheme.onSurface.withAlpha(100)),
          ],
        ],
      ),
      subtitle: Text(
        '$_contextLabel · $_costLabel',
        style: TextStyle(
          color: colorScheme.onSurface.withAlpha(100),
          fontSize: 12,
        ),
      ),
      trailing: isSelected
          ? Icon(Icons.circle, size: 10, color: colorScheme.primary)
          : null,
      onTap: () {
        if (model.requiresByok && !hasByokKey) {
          Navigator.of(context).pop();
          context.push('/settings/byok');
          return;
        }
        if (isLocked) {
          Navigator.of(context).pop();
          context.go('/login');
          return;
        }
        ref.read(selectedModelNotifierProvider.notifier).selectModel(model.id);
        Navigator.of(context).pop();
      },
    );
  }
}

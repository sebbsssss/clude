import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/utils/model_display_name.dart';
import '../models_provider.dart';
import 'model_selector_sheet.dart';

class ModelChip extends ConsumerWidget {
  const ModelChip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final selectedId = ref.watch(selectedModelNotifierProvider);
    final modelName = selectedId != null ? modelDisplayName(selectedId) : null;

    return ActionChip(
      avatar: const Icon(Icons.bolt, size: 14),
      label: Text(
        modelName ?? 'Select model',
        style: const TextStyle(fontSize: 12),
      ),
      side: BorderSide.none,
      onPressed: () => showModalBottomSheet(
        context: context,
        isScrollControlled: true,
        backgroundColor: Theme.of(context).colorScheme.surface,
        shape: const RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
        ),
        builder: (_) => const ModelSelectorSheet(),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models/memory_stats.dart';
import '../../core/auth/auth_provider.dart';
import 'import_pack_sheet.dart';
import 'memory_stats_provider.dart';

const kMemoryTypeColors = <String, Color>{
  'episodic': Color(0xFF2244FF),
  'semantic': Color(0xFF10B981),
  'procedural': Color(0xFFF59E0B),
  'self_model': Color(0xFF8B5CF6),
};

const _typeDisplayNames = <String, String>{
  'episodic': 'Episodic',
  'semantic': 'Semantic',
  'procedural': 'Procedural',
  'self_model': 'Self Model',
};

const _typeOrder = ['episodic', 'semantic', 'procedural', 'self_model'];

class MemoryPanelScreen extends ConsumerWidget {
  const MemoryPanelScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authNotifierProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Memory'),
        actions: [
          IconButton(
            icon: const Icon(Icons.download),
            tooltip: 'Import Pack',
            onPressed: () => showModalBottomSheet(
              context: context,
              builder: (_) => const ImportPackSheet(),
            ),
          ),
        ],
      ),
      body: auth.isAuthenticated
          ? const _StatsBody()
          : const _AuthGate(),
    );
  }
}

class _AuthGate extends StatelessWidget {
  const _AuthGate();

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.lock_outline, size: 48,
              color: Theme.of(context).colorScheme.onSurface.withAlpha(100)),
          const SizedBox(height: 12),
          const Text('Sign in to view your memories'),
        ],
      ),
    );
  }
}

class _StatsBody extends ConsumerWidget {
  const _StatsBody();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncStats = ref.watch(memoryStatsProvider);

    return asyncStats.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, _) => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 48,
                color: Theme.of(context).colorScheme.error),
            const SizedBox(height: 12),
            Text(error.toString(), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: () =>
                  ref.read(memoryStatsProvider.notifier).refresh(),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (stats) => RefreshIndicator(
        onRefresh: () => ref.read(memoryStatsProvider.notifier).refresh(),
        child: CustomScrollView(
          slivers: [
            SliverToBoxAdapter(child: _TotalSection(stats: stats)),
            SliverToBoxAdapter(child: _ByTypeSection(stats: stats)),
            SliverToBoxAdapter(child: _MetricsSection(stats: stats)),
            if (stats.topTags.isNotEmpty)
              SliverToBoxAdapter(child: _TagsSection(stats: stats)),
          ],
        ),
      ),
    );
  }
}

class _TotalSection extends StatelessWidget {
  const _TotalSection({required this.stats});
  final MemoryStats stats;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          Text(
            '${stats.total}',
            style: const TextStyle(fontSize: 56, fontWeight: FontWeight.bold),
          ),
          Text(
            'total memories',
            style: TextStyle(
              color: Theme.of(context).colorScheme.onSurface.withAlpha(150),
            ),
          ),
        ],
      ),
    );
  }
}

class _ByTypeSection extends StatelessWidget {
  const _ByTypeSection({required this.stats});
  final MemoryStats stats;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        children: _typeOrder.map((type) {
          final count = stats.byType[type] ?? 0;
          final color = kMemoryTypeColors[type] ?? Colors.grey;
          final name = _typeDisplayNames[type] ?? type;
          return Padding(
            padding: const EdgeInsets.symmetric(vertical: 6),
            child: Row(
              children: [
                CircleAvatar(radius: 5, backgroundColor: color),
                const SizedBox(width: 8),
                Text(name),
                const Spacer(),
                Text('$count'),
              ],
            ),
          );
        }).toList(),
      ),
    );
  }
}

class _MetricsSection extends StatelessWidget {
  const _MetricsSection({required this.stats});
  final MemoryStats stats;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      child: Column(
        children: [
          _MetricRow(
            label: 'Avg importance',
            value: stats.avgImportance.clamp(0.0, 1.0),
            color: Colors.green,
          ),
          const SizedBox(height: 16),
          _MetricRow(
            label: 'Avg decay',
            value: stats.avgDecay.clamp(0.0, 1.0),
            color: Colors.orange,
            subtitle: 'lower is fresher',
          ),
        ],
      ),
    );
  }
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({
    required this.label,
    required this.value,
    required this.color,
    this.subtitle,
  });

  final String label;
  final double value;
  final Color color;
  final String? subtitle;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text(label),
            const Spacer(),
            Text('${(value * 100).toStringAsFixed(0)}%'),
          ],
        ),
        const SizedBox(height: 4),
        LinearProgressIndicator(
          value: value,
          color: color,
          backgroundColor: color.withAlpha(38),
        ),
        if (subtitle != null)
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Text(
              subtitle!,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurface.withAlpha(100),
                  ),
            ),
          ),
      ],
    );
  }
}

class _TagsSection extends StatelessWidget {
  const _TagsSection({required this.stats});
  final MemoryStats stats;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Top Tags',
              style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            runSpacing: 6,
            children: stats.topTags
                .map((t) => Chip(label: Text('${t.tag} (${t.count})')))
                .toList(),
          ),
        ],
      ),
    );
  }
}

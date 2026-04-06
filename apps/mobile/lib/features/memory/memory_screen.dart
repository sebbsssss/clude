import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api/models/graph_data.dart';
import '../../core/api/models/memory_stats.dart';
import '../../core/api/models/memory_summary.dart';
import '../../core/auth/auth_provider.dart';
import '../../shared/utils/relative_time.dart';
import 'entities_tab.dart';
import 'force_graph_widget.dart';
import 'graph_provider.dart';
import 'import_pack_sheet.dart';
import 'memory_stats_provider.dart';
import 'recent_memories_provider.dart';

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

    if (!auth.isAuthenticated) {
      return Scaffold(
        appBar: AppBar(title: const Text('Memory')),
        body: const _AuthGate(),
      );
    }

    return DefaultTabController(
      length: 3,
      child: Scaffold(
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
          bottom: const TabBar(
            tabs: [
              Tab(text: 'Overview'),
              Tab(text: 'Graph'),
              Tab(text: 'Entities'),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _StatsBody(),
            _GraphTab(),
            EntitiesTab(),
          ],
        ),
      ),
    );
  }
}

class _GraphTab extends ConsumerWidget {
  const _GraphTab();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final asyncGraph = ref.watch(graphProvider);

    return asyncGraph.when(
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
              onPressed: () => ref.invalidate(graphProvider),
              child: const Text('Retry'),
            ),
          ],
        ),
      ),
      data: (graph) => ForceGraphWidget(graph: graph),
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

class _StatsBody extends ConsumerStatefulWidget {
  const _StatsBody();

  @override
  ConsumerState<_StatsBody> createState() => _StatsBodyState();
}

class _StatsBodyState extends ConsumerState<_StatsBody> {
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(recentMemoriesProvider.notifier).loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    final asyncStats = ref.watch(memoryStatsProvider);
    final recentState = ref.watch(recentMemoriesProvider);

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
        onRefresh: () async {
          await Future.wait([
            ref.read(memoryStatsProvider.notifier).refresh(),
            ref.read(recentMemoriesProvider.notifier).refresh(),
          ]);
        },
        child: CustomScrollView(
          controller: _scrollController,
          slivers: [
            SliverToBoxAdapter(child: _TotalSection(stats: stats)),
            SliverToBoxAdapter(child: _ByTypeSection(stats: stats)),
            SliverToBoxAdapter(child: _MetricsSection(stats: stats)),
            if (stats.topTags.isNotEmpty)
              SliverToBoxAdapter(child: _TagsSection(stats: stats)),
            // Recent memories section
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(16, 24, 16, 8),
                child: Text('Recent Memories',
                    style: Theme.of(context).textTheme.titleSmall),
              ),
            ),
            ..._buildRecentSlivers(recentState),
          ],
        ),
      ),
    );
  }

  List<Widget> _buildRecentSlivers(recentState) {
    if (recentState.isLoading && recentState.items.isEmpty) {
      return [
        const SliverToBoxAdapter(
          child: Center(child: Padding(
            padding: EdgeInsets.all(32),
            child: CircularProgressIndicator(),
          )),
        ),
      ];
    }

    if (recentState.error != null && recentState.items.isEmpty) {
      return [
        SliverToBoxAdapter(
          child: Center(
            child: Padding(
              padding: const EdgeInsets.all(32),
              child: Column(
                children: [
                  Text(recentState.error!),
                  const SizedBox(height: 8),
                  ElevatedButton(
                    onPressed: () =>
                        ref.read(recentMemoriesProvider.notifier).fetch(),
                    child: const Text('Retry'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ];
    }

    if (!recentState.isLoading && recentState.items.isEmpty) {
      return [
        const SliverToBoxAdapter(
          child: Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: Text('No memories yet'),
            ),
          ),
        ),
      ];
    }

    return [
      SliverList.builder(
        itemCount: recentState.items.length,
        itemBuilder: (context, index) =>
            MemoryTile(memory: recentState.items[index]),
      ),
      if (recentState.hasMore)
        const SliverToBoxAdapter(
          child: Center(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: CircularProgressIndicator(),
            ),
          ),
        ),
    ];
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

// -- Type badge label mapping --
const _typeBadgeLabels = <String, String>{
  'episodic': 'EPI',
  'semantic': 'SEM',
  'procedural': 'PRO',
  'self_model': 'SLF',
};

Color _importanceColor(double importance) {
  if (importance >= 0.7) return Colors.green.shade400;
  if (importance >= 0.4) return Colors.amber.shade400;
  return Colors.red.shade400;
}

class MemoryTile extends StatefulWidget {
  const MemoryTile({super.key, required this.memory});
  final MemorySummary memory;

  @override
  State<MemoryTile> createState() => _MemoryTileState();
}

class _MemoryTileState extends State<MemoryTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final m = widget.memory;
    final color = kMemoryTypeColors[m.memoryType] ?? Colors.grey;
    final label = _typeBadgeLabels[m.memoryType] ??
        m.memoryType.substring(0, 3).toUpperCase();
    final dotSize = 4.0 + (m.importance.clamp(0.0, 1.0) * 6.0);

    return InkWell(
      onTap: () => setState(() => _expanded = !_expanded),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: color.withAlpha(38),
                borderRadius: BorderRadius.circular(4),
                border: Border.all(color: color.withAlpha(100)),
              ),
              child: Text(
                label,
                style: TextStyle(
                  fontSize: 10,
                  color: color,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  AnimatedSize(
                    duration: const Duration(milliseconds: 200),
                    alignment: Alignment.topLeft,
                    child: Text(
                      m.summary,
                      maxLines: _expanded ? null : 2,
                      overflow: _expanded ? null : TextOverflow.ellipsis,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      Container(
                        width: dotSize,
                        height: dotSize,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: _importanceColor(m.importance),
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        relativeTime(m.createdAt),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Theme.of(context)
                                  .colorScheme
                                  .onSurface
                                  .withAlpha(100),
                            ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

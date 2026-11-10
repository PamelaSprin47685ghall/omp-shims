<script>
import { Card, CardContent } from "framework7-svelte";
import PrimaryMetric from "./PrimaryMetric.svelte";
import TokenTotalsCard from "./TokenTotalsCard.svelte";
import WorkersDisclosure from "./WorkersDisclosure.svelte";

let { snapshot, openItems = new Set(), onToggleItem = () => {} } = $props();
</script>

<section class="status-overview-section" aria-labelledby="overview-heading">
  <h2 id="overview-heading" class="sr-only">核心指标</h2>
  <div class="status-overview">
    <Card class="status-primary-card">
      <CardContent>
        <PrimaryMetric metric={snapshot.metrics.M01} />
        <PrimaryMetric metric={snapshot.metrics.M02} />
      </CardContent>
    </Card>

    <Card class="status-primary-card">
      <CardContent>
        <PrimaryMetric metric={snapshot.metrics.M03}>
          <WorkersDisclosure {snapshot} {openItems} {onToggleItem} />
        </PrimaryMetric>
      </CardContent>
    </Card>

    <Card class="status-primary-card">
      <CardContent>
        <PrimaryMetric metric={snapshot.metrics.M05} />
      </CardContent>
    </Card>

    <Card class="status-primary-card">
      <CardContent>
        <TokenTotalsCard {snapshot} />
      </CardContent>
    </Card>
  </div>
</section>
